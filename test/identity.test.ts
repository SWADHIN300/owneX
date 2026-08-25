import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const HASH_A = ethers.id("profile-record-a");
const HASH_B = ethers.id("profile-record-b");
const ORG_HASH = ethers.id("org-record-abc-corp");
const ZERO_HASH = ethers.ZeroHash;

describe("IdentityRegistry", () => {
  async function deployFixture() {
    const [platform, admin, alice, bob, outsider] = await ethers.getSigners();
    const registry = await ethers.deployContract("IdentityRegistry", [platform.address]);
    return { registry, platform, admin, alice, bob, outsider };
  }

  describe("deployment", () => {
    it("sets the platform owner as the first registrar", async () => {
      const { registry, platform } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(platform.address);
      expect(await registry.isRegistrar(platform.address)).to.equal(true);
    });

    it("rejects the zero address as owner", async () => {
      const factory = await ethers.getContractFactory("IdentityRegistry");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  describe("self-sovereign registration", () => {
    it("lets a wallet register its own identity and emits the audit event", async () => {
      const { registry, alice } = await loadFixture(deployFixture);

      await expect(registry.connect(alice).registerIdentity(HASH_A))
        .to.emit(registry, "IdentityRegistered")
        .withArgs(alice.address, HASH_A, alice.address, anyValue);

      expect(await registry.isActive(alice.address)).to.equal(true);
      expect(await registry.isRegistered(alice.address)).to.equal(true);

      const identity = await registry.getIdentity(alice.address);
      expect(identity.identityHash).to.equal(HASH_A);
      expect(identity.exists).to.equal(true);
      expect(identity.active).to.equal(true);
    });

    it("rejects a duplicate registration", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);

      await expect(registry.connect(alice).registerIdentity(HASH_B))
        .to.be.revertedWithCustomError(registry, "IdentityAlreadyExists")
        .withArgs(alice.address);
    });

    it("rejects an empty identity hash", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      await expect(registry.connect(alice).registerIdentity(ZERO_HASH)).to.be.revertedWithCustomError(
        registry,
        "EmptyHash"
      );
    });
  });

  describe("registrar-driven onboarding", () => {
    it("lets a registrar onboard another wallet", async () => {
      const { registry, platform, bob } = await loadFixture(deployFixture);
      await expect(registry.connect(platform).registerIdentityFor(bob.address, HASH_B))
        .to.emit(registry, "IdentityRegistered")
        .withArgs(bob.address, HASH_B, platform.address, anyValue);
      expect(await registry.isActive(bob.address)).to.equal(true);
    });

    it("blocks a non-registrar from onboarding anyone", async () => {
      const { registry, outsider, bob } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).registerIdentityFor(bob.address, HASH_B))
        .to.be.revertedWithCustomError(registry, "NotAuthorizedRegistrar")
        .withArgs(outsider.address);
    });

    it("rejects the zero address", async () => {
      const { registry, platform } = await loadFixture(deployFixture);
      await expect(
        registry.connect(platform).registerIdentityFor(ethers.ZeroAddress, HASH_B)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("only the owner can appoint registrars", async () => {
      const { registry, platform, admin, bob } = await loadFixture(deployFixture);

      await expect(registry.connect(admin).setRegistrar(admin.address, true)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount"
      );

      await expect(registry.connect(platform).setRegistrar(admin.address, true))
        .to.emit(registry, "RegistrarUpdated")
        .withArgs(admin.address, true);

      await registry.connect(admin).registerIdentityFor(bob.address, HASH_B);
      expect(await registry.isActive(bob.address)).to.equal(true);
    });
  });

  describe("revocation — the kill switch", () => {
    it("lets a registrar revoke an identity", async () => {
      const { registry, platform, alice } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);

      await expect(registry.connect(platform).revokeIdentity(alice.address))
        .to.emit(registry, "IdentityRevoked")
        .withArgs(alice.address, platform.address);

      expect(await registry.isActive(alice.address)).to.equal(false);
      // still registered — the record survives, only access dies
      expect(await registry.isRegistered(alice.address)).to.equal(true);
    });

    it("lets a wallet revoke itself", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);
      await registry.connect(alice).revokeIdentity(alice.address);
      expect(await registry.isActive(alice.address)).to.equal(false);
    });

    it("blocks an unrelated wallet from revoking someone else", async () => {
      const { registry, alice, outsider } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);

      await expect(registry.connect(outsider).revokeIdentity(alice.address))
        .to.be.revertedWithCustomError(registry, "NotAuthorizedRegistrar")
        .withArgs(outsider.address);
    });

    it("cannot revoke twice or revoke an unknown wallet", async () => {
      const { registry, platform, alice, bob } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);
      await registry.connect(platform).revokeIdentity(alice.address);

      await expect(registry.connect(platform).revokeIdentity(alice.address)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotActive"
      );
      await expect(registry.connect(platform).revokeIdentity(bob.address)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotFound"
      );
    });

    it("reactivates a revoked identity, registrar only", async () => {
      const { registry, platform, alice, outsider } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);
      await registry.connect(platform).revokeIdentity(alice.address);

      await expect(registry.connect(outsider).reactivateIdentity(alice.address)).to.be.revertedWithCustomError(
        registry,
        "NotAuthorizedRegistrar"
      );

      await expect(registry.connect(platform).reactivateIdentity(alice.address))
        .to.emit(registry, "IdentityReactivated")
        .withArgs(alice.address, platform.address);
      expect(await registry.isActive(alice.address)).to.equal(true);

      await expect(registry.connect(platform).reactivateIdentity(alice.address)).to.be.revertedWithCustomError(
        registry,
        "IdentityAlreadyActive"
      );
    });
  });

  describe("hash anchoring", () => {
    it("verifies a matching off-chain record and rejects a tampered one", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);

      expect(await registry.verifyIdentityHash(alice.address, HASH_A)).to.equal(true);
      expect(await registry.verifyIdentityHash(alice.address, HASH_B)).to.equal(false);
    });

    it("lets the wallet rotate its own hash but not while revoked", async () => {
      const { registry, platform, alice } = await loadFixture(deployFixture);
      await registry.connect(alice).registerIdentity(HASH_A);

      await expect(registry.connect(alice).updateIdentityHash(HASH_B))
        .to.emit(registry, "IdentityHashUpdated")
        .withArgs(alice.address, HASH_A, HASH_B, alice.address);
      expect(await registry.verifyIdentityHash(alice.address, HASH_B)).to.equal(true);

      await registry.connect(platform).revokeIdentity(alice.address);
      await expect(registry.connect(alice).updateIdentityHash(HASH_A)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotActive"
      );
    });

    it("rejects rotation from an unregistered wallet", async () => {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).updateIdentityHash(HASH_A)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotFound"
      );
    });
  });

  describe("organizations", () => {
    it("creates an organization and makes the creator root admin", async () => {
      const { registry, admin } = await loadFixture(deployFixture);
      await registry.connect(admin).registerIdentity(HASH_A);

      await expect(registry.connect(admin).createOrganization(ORG_HASH))
        .to.emit(registry, "OrganizationCreated")
        .withArgs(1n, admin.address, ORG_HASH, anyValue);

      expect(await registry.organizationCount()).to.equal(1n);
      expect(await registry.organizationExists(1n)).to.equal(true);
      expect(await registry.isOrganizationActive(1n)).to.equal(true);
      expect(await registry.orgRootAdmin(1n)).to.equal(admin.address);

      const org = await registry.getOrganization(1n);
      expect(org.metadataHash).to.equal(ORG_HASH);
      expect(org.active).to.equal(true);
    });

    it("requires an active identity to create an organization", async () => {
      const { registry, platform, admin, outsider } = await loadFixture(deployFixture);

      await expect(registry.connect(outsider).createOrganization(ORG_HASH)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotFound"
      );

      await registry.connect(admin).registerIdentity(HASH_A);
      await registry.connect(platform).revokeIdentity(admin.address);
      await expect(registry.connect(admin).createOrganization(ORG_HASH)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotActive"
      );
    });

    it("reports unknown organizations as non-existent", async () => {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.organizationExists(0n)).to.equal(false);
      expect(await registry.organizationExists(99n)).to.equal(false);
      expect(await registry.isOrganizationActive(99n)).to.equal(false);
    });

    it("only the root admin updates org metadata", async () => {
      const { registry, admin, alice } = await loadFixture(deployFixture);
      await registry.connect(admin).registerIdentity(HASH_A);
      await registry.connect(admin).createOrganization(ORG_HASH);

      await expect(registry.connect(alice).updateOrganizationMetadata(1n, HASH_B))
        .to.be.revertedWithCustomError(registry, "NotOrgRootAdmin")
        .withArgs(1n, alice.address);

      await expect(registry.connect(admin).updateOrganizationMetadata(1n, HASH_B))
        .to.emit(registry, "OrganizationMetadataUpdated")
        .withArgs(1n, ORG_HASH, HASH_B);
    });

    it("suspends and resumes an organization, root admin or platform owner", async () => {
      const { registry, platform, admin, alice } = await loadFixture(deployFixture);
      await registry.connect(admin).registerIdentity(HASH_A);
      await registry.connect(admin).createOrganization(ORG_HASH);

      await expect(registry.connect(alice).setOrganizationActive(1n, false)).to.be.revertedWithCustomError(
        registry,
        "NotOrgRootAdmin"
      );

      await expect(registry.connect(admin).setOrganizationActive(1n, false))
        .to.emit(registry, "OrganizationStatusChanged")
        .withArgs(1n, false, admin.address);
      expect(await registry.isOrganizationActive(1n)).to.equal(false);

      // platform owner acts as the escalation path
      await registry.connect(platform).setOrganizationActive(1n, true);
      expect(await registry.isOrganizationActive(1n)).to.equal(true);
    });

    it("transfers the root admin seat only to an active identity", async () => {
      const { registry, admin, alice, outsider } = await loadFixture(deployFixture);
      await registry.connect(admin).registerIdentity(HASH_A);
      await registry.connect(admin).createOrganization(ORG_HASH);

      await expect(registry.connect(admin).transferOrgRootAdmin(1n, outsider.address)).to.be.revertedWithCustomError(
        registry,
        "IdentityNotFound"
      );

      await registry.connect(alice).registerIdentity(HASH_B);
      await expect(registry.connect(admin).transferOrgRootAdmin(1n, alice.address))
        .to.emit(registry, "OrgRootAdminTransferred")
        .withArgs(1n, admin.address, alice.address);

      expect(await registry.orgRootAdmin(1n)).to.equal(alice.address);
      // the previous admin no longer governs
      await expect(registry.connect(admin).updateOrganizationMetadata(1n, HASH_A)).to.be.revertedWithCustomError(
        registry,
        "NotOrgRootAdmin"
      );
    });

    it("rejects operations on an unknown organization", async () => {
      const { registry, admin } = await loadFixture(deployFixture);
      await registry.connect(admin).registerIdentity(HASH_A);
      await expect(registry.connect(admin).setOrganizationActive(7n, false))
        .to.be.revertedWithCustomError(registry, "OrganizationNotFound")
        .withArgs(7n);
    });
  });
});

