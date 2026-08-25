import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const ORG_HASH = ethers.id("org-record-abc-corp");
const ASSET_HASH = ethers.id("laptop-001-serial-ABC123");
const ASSET_HASH_2 = ethers.id("certificate-002-record");
const URI = "https://ownex.local/api/metadata/1";
const URI_2 = "https://ownex.local/api/metadata/2";
const NEVER = 0n;

describe("AssetNFT", () => {
  async function deployFixture() {
    const [platform, admin, manager, auditor, user, other, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("IdentityRegistry", [platform.address]);
    const access = await ethers.deployContract("OrgAccessManager", [await registry.getAddress()]);
    const asset = await ethers.deployContract("AssetNFT", [
      await registry.getAddress(),
      await access.getAddress(),
      platform.address,
    ]);

    for (const [i, signer] of [admin, manager, auditor, user, other].entries()) {
      await registry.connect(signer).registerIdentity(ethers.id(`profile-${i}`));
    }
    await registry.connect(admin).createOrganization(ORG_HASH);

    const orgId = 1n;
    const ROLE_MANAGER = await access.ROLE_MANAGER();
    const ROLE_AUDITOR = await access.ROLE_AUDITOR();
    const ROLE_USER = await access.ROLE_USER();
    const PERM_MINT_ASSETS = await access.PERM_MINT_ASSETS();
    const PERM_TRANSFER_ASSETS = await access.PERM_TRANSFER_ASSETS();

    await access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER);
    await access.connect(admin).addMember(orgId, auditor.address, ROLE_AUDITOR, NEVER);
    await access.connect(admin).addMember(orgId, user.address, ROLE_USER, NEVER);
    await access.connect(admin).addMember(orgId, other.address, ROLE_USER, NEVER);

    return {
      registry,
      access,
      asset,
      platform,
      admin,
      manager,
      auditor,
      user,
      other,
      outsider,
      orgId,
      PERM_MINT_ASSETS,
      PERM_TRANSFER_ASSETS,
    };
  }

  /** Fixture with token #1 already minted to `user`. */
  async function mintedFixture() {
    const ctx = await deployFixture();
    await ctx.asset.connect(ctx.admin).mintAsset(ctx.orgId, ctx.user.address, ASSET_HASH, URI);
    return { ...ctx, tokenId: 1n };
  }

  describe("deployment", () => {
    it("exposes ERC-721 identity and rejects zero addresses", async () => {
      const { asset, registry, access, platform } = await loadFixture(deployFixture);
      expect(await asset.name()).to.equal("OwneX Asset Certificate");
      expect(await asset.symbol()).to.equal("OWNX");
      expect(await asset.owner()).to.equal(platform.address);
      expect(await asset.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await asset.supportsInterface("0x5b5e139f")).to.equal(true); // ERC721Metadata
      expect(await asset.supportsInterface("0x780e9d63")).to.equal(true); // ERC721Enumerable

      const factory = await ethers.getContractFactory("AssetNFT");
      await expect(
        factory.deploy(ethers.ZeroAddress, await access.getAddress(), platform.address)
      ).to.be.revertedWithCustomError(asset, "ZeroAddress");
      await expect(
        factory.deploy(await registry.getAddress(), ethers.ZeroAddress, platform.address)
      ).to.be.revertedWithCustomError(asset, "ZeroAddress");
    });
  });

  describe("minting", () => {
    it("an admin mints an asset to a member and records it fully", async () => {
      const { asset, admin, user, orgId } = await loadFixture(deployFixture);

      await expect(asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH, URI))
        .to.emit(asset, "AssetMinted")
        .withArgs(1n, orgId, user.address, ASSET_HASH, URI, admin.address);

      expect(await asset.ownerOf(1n)).to.equal(user.address);
      expect(await asset.tokenURI(1n)).to.equal(URI);
      expect(await asset.totalMinted()).to.equal(1n);
      expect(await asset.balanceOf(user.address)).to.equal(1n);

      const record = await asset.getAsset(1n);
      expect(record.orgId).to.equal(orgId);
      expect(record.assetHash).to.equal(ASSET_HASH);
      expect(record.assignedTo).to.equal(user.address);
      expect(record.active).to.equal(true);
      expect(record.transferCount).to.equal(0n);
      expect(record.mintedAt).to.be.greaterThan(0n);
    });

    it("issues sequential, unique token ids", async () => {
      const { asset, admin, user, other, orgId } = await loadFixture(deployFixture);
      await asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH, URI);
      await asset.connect(admin).mintAsset(orgId, other.address, ASSET_HASH_2, URI_2);

      expect(await asset.ownerOf(1n)).to.equal(user.address);
      expect(await asset.ownerOf(2n)).to.equal(other.address);
      expect(await asset.totalMinted()).to.equal(2n);
      expect(await asset.assetsOfOrganization(orgId)).to.deep.equal([1n, 2n]);
      expect(await asset.organizationAssetCount(orgId)).to.equal(2n);
    });

    it("BLOCKS a plain user from minting — the core security guarantee", async () => {
      const { asset, user, orgId, PERM_MINT_ASSETS } = await loadFixture(deployFixture);
      await expect(asset.connect(user).mintAsset(orgId, user.address, ASSET_HASH, URI))
        .to.be.revertedWithCustomError(asset, "MissingPermission")
        .withArgs(orgId, user.address, PERM_MINT_ASSETS);
    });

    it("blocks a manager and an auditor from minting by default", async () => {
      const { asset, manager, auditor, user, orgId } = await loadFixture(deployFixture);
      await expect(
        asset.connect(manager).mintAsset(orgId, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");
      await expect(
        asset.connect(auditor).mintAsset(orgId, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");
    });

    it("lets an org opt a manager into minting via a permission override", async () => {
      const { asset, access, admin, manager, user, orgId } = await loadFixture(deployFixture);
      const ROLE_MANAGER = await access.ROLE_MANAGER();
      const PERM_MINT_ASSETS = await access.PERM_MINT_ASSETS();

      await access.connect(admin).setPermission(orgId, ROLE_MANAGER, PERM_MINT_ASSETS, 1);
      await expect(asset.connect(manager).mintAsset(orgId, user.address, ASSET_HASH, URI)).to.emit(
        asset,
        "AssetMinted"
      );
    });

    it("blocks a complete outsider", async () => {
      const { asset, outsider, user, orgId } = await loadFixture(deployFixture);
      await expect(
        asset.connect(outsider).mintAsset(orgId, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");
    });

    it("refuses to assign an asset to a non-member", async () => {
      const { asset, registry, admin, outsider, orgId } = await loadFixture(deployFixture);
      await registry.connect(outsider).registerIdentity(ethers.id("outsider-profile"));

      await expect(asset.connect(admin).mintAsset(orgId, outsider.address, ASSET_HASH, URI))
        .to.be.revertedWithCustomError(asset, "RecipientNotOrgMember")
        .withArgs(orgId, outsider.address);
    });

    it("refuses to assign an asset to a revoked identity", async () => {
      const { asset, registry, platform, admin, user, orgId } = await loadFixture(deployFixture);
      await registry.connect(platform).revokeIdentity(user.address);
      await expect(
        asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "RecipientNotOrgMember");
    });

    it("validates inputs: zero address, empty hash, empty URI", async () => {
      const { asset, admin, user, orgId } = await loadFixture(deployFixture);
      await expect(
        asset.connect(admin).mintAsset(orgId, ethers.ZeroAddress, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "ZeroAddress");
      await expect(
        asset.connect(admin).mintAsset(orgId, user.address, ethers.ZeroHash, URI)
      ).to.be.revertedWithCustomError(asset, "EmptyHash");
      await expect(
        asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH, "")
      ).to.be.revertedWithCustomError(asset, "EmptyURI");
    });

    it("rejects minting into an unknown or suspended organization", async () => {
      const { asset, registry, admin, user, orgId } = await loadFixture(deployFixture);
      await expect(
        asset.connect(admin).mintAsset(99n, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");

      await registry.connect(admin).setOrganizationActive(orgId, false);
      await expect(
        asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH, URI)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");
    });
  });

  describe("transfer lock — company assets are not tradeable", () => {
    it("the holder CANNOT transfer the asset away", async () => {
      const { asset, user, other, tokenId } = await loadFixture(mintedFixture);

      await expect(asset.connect(user).transferFrom(user.address, other.address, tokenId))
        .to.be.revertedWithCustomError(asset, "TransfersLocked")
        .withArgs(tokenId);

      await expect(
        asset.connect(user)["safeTransferFrom(address,address,uint256)"](user.address, other.address, tokenId)
      ).to.be.revertedWithCustomError(asset, "TransfersLocked");

      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
    });

    it("an approved third party still cannot move it", async () => {
      const { asset, user, other, outsider, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(user).approve(outsider.address, tokenId);

      await expect(
        asset.connect(outsider).transferFrom(user.address, other.address, tokenId)
      ).to.be.revertedWithCustomError(asset, "TransfersLocked");
    });

    it("an operator approved for all still cannot move it", async () => {
      const { asset, user, other, outsider, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(user).setApprovalForAll(outsider.address, true);

      await expect(
        asset.connect(outsider).transferFrom(user.address, other.address, tokenId)
      ).to.be.revertedWithCustomError(asset, "TransfersLocked");
    });
  });

  describe("organization-controlled reassignment", () => {
    it("a manager reassigns the asset to another member", async () => {
      const { asset, manager, user, other, tokenId } = await loadFixture(mintedFixture);

      await expect(asset.connect(manager).reassignAsset(tokenId, other.address))
        .to.emit(asset, "AssetAssigned")
        .withArgs(tokenId, user.address, other.address, manager.address);

      expect(await asset.ownerOf(tokenId)).to.equal(other.address);
      const record = await asset.getAsset(tokenId);
      expect(record.assignedTo).to.equal(other.address);
      expect(record.transferCount).to.equal(1n);
    });

    it("an auditor and a plain user cannot reassign", async () => {
      const { asset, auditor, user, other, tokenId, PERM_TRANSFER_ASSETS, orgId } = await loadFixture(mintedFixture);

      await expect(asset.connect(auditor).reassignAsset(tokenId, other.address)).to.be.revertedWithCustomError(
        asset,
        "MissingPermission"
      );
      await expect(asset.connect(user).reassignAsset(tokenId, other.address))
        .to.be.revertedWithCustomError(asset, "MissingPermission")
        .withArgs(orgId, user.address, PERM_TRANSFER_ASSETS);
    });

    it("refuses a non-member recipient and a no-op reassignment", async () => {
      const { asset, admin, user, outsider, tokenId } = await loadFixture(mintedFixture);
      await expect(asset.connect(admin).reassignAsset(tokenId, outsider.address)).to.be.revertedWithCustomError(
        asset,
        "RecipientNotOrgMember"
      );
      await expect(asset.connect(admin).reassignAsset(tokenId, user.address))
        .to.be.revertedWithCustomError(asset, "AlreadyAssignedTo")
        .withArgs(user.address);
      await expect(asset.connect(admin).reassignAsset(tokenId, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        asset,
        "ZeroAddress"
      );
    });

    it("rejects an unknown token", async () => {
      const { asset, admin, other } = await loadFixture(mintedFixture);
      await expect(asset.connect(admin).reassignAsset(42n, other.address))
        .to.be.revertedWithCustomError(asset, "UnknownAsset")
        .withArgs(42n);
    });
  });

  describe("revocation and restoration", () => {
    it("revoking pulls custody back to the org root admin", async () => {
      const { asset, admin, user, tokenId } = await loadFixture(mintedFixture);

      await expect(asset.connect(admin).revokeAsset(tokenId))
        .to.emit(asset, "AssetRevoked")
        .withArgs(tokenId, user.address, admin.address, admin.address);

      expect(await asset.ownerOf(tokenId)).to.equal(admin.address);
      const record = await asset.getAsset(tokenId);
      expect(record.active).to.equal(false);
      expect(record.assignedTo).to.equal(admin.address);
    });

    it("a revoked asset cannot be reassigned or revoked again", async () => {
      const { asset, admin, other, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(admin).revokeAsset(tokenId);

      await expect(asset.connect(admin).reassignAsset(tokenId, other.address))
        .to.be.revertedWithCustomError(asset, "AssetInactive")
        .withArgs(tokenId);
      await expect(asset.connect(admin).revokeAsset(tokenId)).to.be.revertedWithCustomError(asset, "AssetInactive");
    });

    it("a plain user cannot revoke", async () => {
      const { asset, user, tokenId } = await loadFixture(mintedFixture);
      await expect(asset.connect(user).revokeAsset(tokenId)).to.be.revertedWithCustomError(
        asset,
        "MissingPermission"
      );
    });

    it("restores a revoked asset back into service", async () => {
      const { asset, admin, other, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(admin).revokeAsset(tokenId);

      await expect(asset.connect(admin).restoreAsset(tokenId, other.address))
        .to.emit(asset, "AssetRestored")
        .withArgs(tokenId, other.address, admin.address);

      expect(await asset.ownerOf(tokenId)).to.equal(other.address);
      const record = await asset.getAsset(tokenId);
      expect(record.active).to.equal(true);
      expect(record.assignedTo).to.equal(other.address);

      await expect(asset.connect(admin).restoreAsset(tokenId, other.address)).to.be.revertedWithCustomError(
        asset,
        "AssetAlreadyActive"
      );
    });
  });

  describe("ownership verification — what third parties call", () => {
    it("confirms a legitimate holder", async () => {
      const { asset, user, other, tokenId } = await loadFixture(mintedFixture);
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(true);
      expect(await asset.verifyOwnership(tokenId, other.address)).to.equal(false);
    });

    it("fails verification once the holder's identity is revoked", async () => {
      const { asset, registry, platform, user, tokenId } = await loadFixture(mintedFixture);
      await registry.connect(platform).revokeIdentity(user.address);
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(false);
    });

    it("fails verification once the asset is revoked", async () => {
      const { asset, admin, user, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(admin).revokeAsset(tokenId);
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(false);
    });

    it("fails verification when the organization is suspended", async () => {
      const { asset, registry, admin, user, tokenId, orgId } = await loadFixture(mintedFixture);
      await registry.connect(admin).setOrganizationActive(orgId, false);
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(false);
    });

    it("fails verification once the holder leaves the organization", async () => {
      const { asset, access, admin, user, tokenId, orgId } = await loadFixture(mintedFixture);
      await access.connect(admin).removeMember(orgId, user.address);
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(false);
    });

    it("returns false for an unknown token instead of reverting", async () => {
      const { asset, user } = await loadFixture(mintedFixture);
      expect(await asset.verifyOwnership(999n, user.address)).to.equal(false);
      expect(await asset.verifyAssetHash(999n, ASSET_HASH)).to.equal(false);
    });

    it("detects a tampered off-chain asset record", async () => {
      const { asset, tokenId } = await loadFixture(mintedFixture);
      expect(await asset.verifyAssetHash(tokenId, ASSET_HASH)).to.equal(true);
      expect(await asset.verifyAssetHash(tokenId, ethers.id("tampered-record"))).to.equal(false);
    });
  });

  describe("record updates", () => {
    it("re-anchors the hash and URI when the off-chain record legitimately changes", async () => {
      const { asset, admin, tokenId } = await loadFixture(mintedFixture);

      await expect(asset.connect(admin).updateAssetRecord(tokenId, ASSET_HASH_2, URI_2))
        .to.emit(asset, "AssetMetadataUpdated")
        .withArgs(tokenId, ASSET_HASH, ASSET_HASH_2, URI_2, admin.address);

      expect(await asset.tokenURI(tokenId)).to.equal(URI_2);
      expect(await asset.verifyAssetHash(tokenId, ASSET_HASH_2)).to.equal(true);
      expect(await asset.verifyAssetHash(tokenId, ASSET_HASH)).to.equal(false);
    });

    it("requires mint permission and valid inputs", async () => {
      const { asset, manager, admin, tokenId } = await loadFixture(mintedFixture);
      await expect(
        asset.connect(manager).updateAssetRecord(tokenId, ASSET_HASH_2, URI_2)
      ).to.be.revertedWithCustomError(asset, "MissingPermission");
      await expect(
        asset.connect(admin).updateAssetRecord(tokenId, ethers.ZeroHash, URI_2)
      ).to.be.revertedWithCustomError(asset, "EmptyHash");
      await expect(asset.connect(admin).updateAssetRecord(tokenId, ASSET_HASH_2, "")).to.be.revertedWithCustomError(
        asset,
        "EmptyURI"
      );
    });
  });

  describe("emergency pause", () => {
    it("only the platform owner can pause", async () => {
      const { asset, admin, platform } = await loadFixture(mintedFixture);
      await expect(asset.connect(admin).pause()).to.be.revertedWithCustomError(
        asset,
        "OwnableUnauthorizedAccount"
      );
      await asset.connect(platform).pause();
      expect(await asset.paused()).to.equal(true);
    });

    it("pausing halts minting, reassignment, and revocation", async () => {
      const { asset, platform, admin, user, other, orgId, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(platform).pause();

      await expect(
        asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH_2, URI_2)
      ).to.be.revertedWithCustomError(asset, "EnforcedPause");
      await expect(asset.connect(admin).reassignAsset(tokenId, other.address)).to.be.revertedWithCustomError(
        asset,
        "EnforcedPause"
      );
      await expect(asset.connect(admin).revokeAsset(tokenId)).to.be.revertedWithCustomError(asset, "EnforcedPause");

      await asset.connect(platform).unpause();
      await expect(asset.connect(admin).reassignAsset(tokenId, other.address)).to.emit(asset, "AssetAssigned");
    });

    it("reads stay available while paused", async () => {
      const { asset, platform, user, tokenId } = await loadFixture(mintedFixture);
      await asset.connect(platform).pause();
      expect(await asset.verifyOwnership(tokenId, user.address)).to.equal(true);
      expect(await asset.tokenURI(tokenId)).to.equal(URI);
    });
  });

  describe("holder queries", () => {
    it("lists every asset a wallet holds without an indexer", async () => {
      const { asset, admin, user, orgId } = await loadFixture(mintedFixture);
      await asset.connect(admin).mintAsset(orgId, user.address, ASSET_HASH_2, URI_2);

      const held = await asset.assetsOfHolder(user.address);
      expect(held).to.deep.equal([1n, 2n]);
      expect(await asset.assetsOfHolder(admin.address)).to.deep.equal([]);
      void anyValue;
    });
  });
});
