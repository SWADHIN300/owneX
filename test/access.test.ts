import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const ORG_HASH = ethers.id("org-record-abc-corp");
const APP_ID = ethers.id("employee-portal");
const APP_HASH = ethers.id("employee-portal-record");
const NEVER = 0n;

describe("OrgAccessManager", () => {
  async function deployFixture() {
    const [platform, admin, manager, auditor, user, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("IdentityRegistry", [platform.address]);
    const access = await ethers.deployContract("OrgAccessManager", [await registry.getAddress()]);

    // every participant holds an identity; admin owns org #1
    for (const [i, signer] of [admin, manager, auditor, user].entries()) {
      await registry.connect(signer).registerIdentity(ethers.id(`profile-${i}`));
    }
    await registry.connect(admin).createOrganization(ORG_HASH);

    const ROLE_ADMIN = await access.ROLE_ADMIN();
    const ROLE_MANAGER = await access.ROLE_MANAGER();
    const ROLE_AUDITOR = await access.ROLE_AUDITOR();
    const ROLE_USER = await access.ROLE_USER();
    const ROLE_NONE = await access.ROLE_NONE();

    const PERM_MANAGE_MEMBERS = await access.PERM_MANAGE_MEMBERS();
    const PERM_ASSIGN_ROLES = await access.PERM_ASSIGN_ROLES();
    const PERM_MINT_ASSETS = await access.PERM_MINT_ASSETS();
    const PERM_TRANSFER_ASSETS = await access.PERM_TRANSFER_ASSETS();
    const PERM_VIEW_AUDIT = await access.PERM_VIEW_AUDIT();
    const PERM_MANAGE_APPS = await access.PERM_MANAGE_APPS();

    return {
      registry,
      access,
      platform,
      admin,
      manager,
      auditor,
      user,
      outsider,
      orgId: 1n,
      ROLE_ADMIN,
      ROLE_MANAGER,
      ROLE_AUDITOR,
      ROLE_USER,
      ROLE_NONE,
      PERM_MANAGE_MEMBERS,
      PERM_ASSIGN_ROLES,
      PERM_MINT_ASSETS,
      PERM_TRANSFER_ASSETS,
      PERM_VIEW_AUDIT,
      PERM_MANAGE_APPS,
    };
  }

  /** Fixture with the full four-role organization already populated. */
  async function staffedFixture() {
    const ctx = await deployFixture();
    const { access, admin, manager, auditor, user, orgId, ROLE_MANAGER, ROLE_AUDITOR, ROLE_USER } = ctx;
    await access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER);
    await access.connect(admin).addMember(orgId, auditor.address, ROLE_AUDITOR, NEVER);
    await access.connect(admin).addMember(orgId, user.address, ROLE_USER, NEVER);
    return ctx;
  }

  describe("bootstrap", () => {
    it("resolves the org root admin to ADMIN with no configuration transaction", async () => {
      const { access, admin, orgId, ROLE_ADMIN } = await loadFixture(deployFixture);
      expect(await access.effectiveRole(orgId, admin.address)).to.equal(ROLE_ADMIN);
      expect(await access.isMember(orgId, admin.address)).to.equal(true);
    });

    it("reports no role for a stranger", async () => {
      const { access, outsider, orgId, ROLE_NONE } = await loadFixture(deployFixture);
      expect(await access.effectiveRole(orgId, outsider.address)).to.equal(ROLE_NONE);
      expect(await access.isMember(orgId, outsider.address)).to.equal(false);
    });

    it("rejects the zero address as the identity registry", async () => {
      const factory = await ethers.getContractFactory("OrgAccessManager");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  describe("adding members", () => {
    it("admin adds a member and emits both audit events", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER, ROLE_NONE } = await loadFixture(deployFixture);

      const tx = access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER);
      await expect(tx)
        .to.emit(access, "MemberAdded")
        .withArgs(orgId, manager.address, ROLE_MANAGER, NEVER, admin.address);
      await expect(tx)
        .to.emit(access, "RoleAssigned")
        .withArgs(orgId, manager.address, ROLE_NONE, ROLE_MANAGER, NEVER, admin.address);

      expect(await access.effectiveRole(orgId, manager.address)).to.equal(ROLE_MANAGER);
      expect(await access.memberCount(orgId)).to.equal(1n);
    });

    it("blocks a plain USER from adding members", async () => {
      const { access, admin, user, outsider, orgId, ROLE_USER, PERM_MANAGE_MEMBERS } = await loadFixture(deployFixture);
      await access.connect(admin).addMember(orgId, user.address, ROLE_USER, NEVER);

      await expect(access.connect(user).addMember(orgId, outsider.address, ROLE_USER, NEVER))
        .to.be.revertedWithCustomError(access, "MissingPermission")
        .withArgs(orgId, user.address, PERM_MANAGE_MEMBERS);
    });

    it("blocks an AUDITOR from adding members — read-only by design", async () => {
      const { access, auditor, outsider, orgId, ROLE_USER } = await loadFixture(staffedFixture);
      await expect(
        access.connect(auditor).addMember(orgId, outsider.address, ROLE_USER, NEVER)
      ).to.be.revertedWithCustomError(access, "MissingPermission");
    });

    it("rejects a wallet with no active identity", async () => {
      const { access, registry, platform, admin, user, outsider, orgId, ROLE_USER } = await loadFixture(deployFixture);

      await expect(access.connect(admin).addMember(orgId, outsider.address, ROLE_USER, NEVER))
        .to.be.revertedWithCustomError(access, "IdentityNotActive")
        .withArgs(outsider.address);

      await registry.connect(platform).revokeIdentity(user.address);
      await expect(
        access.connect(admin).addMember(orgId, user.address, ROLE_USER, NEVER)
      ).to.be.revertedWithCustomError(access, "IdentityNotActive");
    });

    it("rejects duplicates, the zero address, and unknown roles", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER } = await loadFixture(deployFixture);
      await access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER);

      await expect(access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER))
        .to.be.revertedWithCustomError(access, "AlreadyMember")
        .withArgs(orgId, manager.address);

      await expect(
        access.connect(admin).addMember(orgId, ethers.ZeroAddress, ROLE_MANAGER, NEVER)
      ).to.be.revertedWithCustomError(access, "ZeroAddress");

      await expect(access.connect(admin).addMember(orgId, manager.address, ethers.id("FAKE_ROLE"), NEVER))
        .to.be.revertedWithCustomError(access, "InvalidRole")
        .withArgs(ethers.id("FAKE_ROLE"));
    });

    it("rejects an unknown or suspended organization", async () => {
      const { access, registry, admin, manager, orgId, ROLE_MANAGER } = await loadFixture(deployFixture);

      await expect(access.connect(admin).addMember(99n, manager.address, ROLE_MANAGER, NEVER))
        .to.be.revertedWithCustomError(access, "OrganizationNotFound")
        .withArgs(99n);

      await registry.connect(admin).setOrganizationActive(orgId, false);
      await expect(access.connect(admin).addMember(orgId, manager.address, ROLE_MANAGER, NEVER))
        .to.be.revertedWithCustomError(access, "OrganizationSuspended")
        .withArgs(orgId);
    });
  });

  describe("role assignment", () => {
    it("admin promotes a user to manager", async () => {
      const { access, admin, user, orgId, ROLE_USER, ROLE_MANAGER } = await loadFixture(staffedFixture);

      await expect(access.connect(admin).assignRole(orgId, user.address, ROLE_MANAGER, NEVER))
        .to.emit(access, "RoleAssigned")
        .withArgs(orgId, user.address, ROLE_USER, ROLE_MANAGER, NEVER, admin.address);

      expect(await access.effectiveRole(orgId, user.address)).to.equal(ROLE_MANAGER);
    });

    it("nobody can promote themselves", async () => {
      const { access, admin, manager, orgId, ROLE_ADMIN } = await loadFixture(staffedFixture);

      // A manager lacks PERM_ASSIGN_ROLES outright.
      await expect(
        access.connect(manager).assignRole(orgId, manager.address, ROLE_ADMIN, NEVER)
      ).to.be.revertedWithCustomError(access, "MissingPermission");

      // And even a full admin cannot target their own membership.
      await expect(
        access.connect(admin).assignRole(orgId, admin.address, ROLE_ADMIN, NEVER)
      ).to.be.revertedWithCustomError(access, "CannotTargetSelf");
    });

    it("a MANAGER cannot reassign roles", async () => {
      const { access, manager, user, orgId, ROLE_ADMIN, PERM_ASSIGN_ROLES } = await loadFixture(staffedFixture);
      await expect(access.connect(manager).assignRole(orgId, user.address, ROLE_ADMIN, NEVER))
        .to.be.revertedWithCustomError(access, "MissingPermission")
        .withArgs(orgId, manager.address, PERM_ASSIGN_ROLES);
    });

    it("the root admin's seat cannot be altered through RBAC", async () => {
      const { access, admin, manager, orgId, ROLE_ADMIN, ROLE_USER } = await loadFixture(staffedFixture);

      // Promote the manager to ADMIN so a second governance-capable caller exists.
      await access.connect(admin).assignRole(orgId, manager.address, ROLE_ADMIN, NEVER);

      await expect(access.connect(manager).assignRole(orgId, admin.address, ROLE_USER, NEVER))
        .to.be.revertedWithCustomError(access, "CannotModifyRootAdmin")
        .withArgs(orgId);

      await expect(access.connect(manager).removeMember(orgId, admin.address)).to.be.revertedWithCustomError(
        access,
        "CannotModifyRootAdmin"
      );

      await expect(
        access.connect(manager).setRoleExpiry(orgId, admin.address, BigInt(await time.latest()) + 3600n)
      ).to.be.revertedWithCustomError(access, "CannotModifyRootAdmin");
    });

    it("cannot assign a role to a non-member", async () => {
      const { access, registry, admin, outsider, orgId, ROLE_USER } = await loadFixture(staffedFixture);
      await registry.connect(outsider).registerIdentity(ethers.id("outsider-profile"));

      await expect(access.connect(admin).assignRole(orgId, outsider.address, ROLE_USER, NEVER))
        .to.be.revertedWithCustomError(access, "NotMember")
        .withArgs(orgId, outsider.address);
    });
  });

  describe("time-bound access", () => {
    it("a role lapses automatically once its expiry passes", async () => {
      const { access, admin, outsider, registry, orgId, ROLE_MANAGER, ROLE_NONE, PERM_TRANSFER_ASSETS } =
        await loadFixture(staffedFixture);

      await registry.connect(outsider).registerIdentity(ethers.id("contractor-profile"));
      const expiry = BigInt(await time.latest()) + 3600n;
      await access.connect(admin).addMember(orgId, outsider.address, ROLE_MANAGER, expiry);

      expect(await access.effectiveRole(orgId, outsider.address)).to.equal(ROLE_MANAGER);
      expect(await access.hasPermission(orgId, outsider.address, PERM_TRANSFER_ASSETS)).to.equal(true);

      await time.increaseTo(expiry + 1n);

      expect(await access.effectiveRole(orgId, outsider.address)).to.equal(ROLE_NONE);
      expect(await access.hasPermission(orgId, outsider.address, PERM_TRANSFER_ASSETS)).to.equal(false);
      expect(await access.isMember(orgId, outsider.address)).to.equal(false);
    });

    it("expiry can be extended before it lapses", async () => {
      const { access, admin, user, orgId, ROLE_USER } = await loadFixture(staffedFixture);
      const first = BigInt(await time.latest()) + 3600n;
      await access.connect(admin).assignRole(orgId, user.address, ROLE_USER, first);

      const extended = first + 7200n;
      await expect(access.connect(admin).setRoleExpiry(orgId, user.address, extended))
        .to.emit(access, "RoleExpiryUpdated")
        .withArgs(orgId, user.address, first, extended, admin.address);

      await time.increaseTo(first + 10n);
      expect(await access.effectiveRole(orgId, user.address)).to.equal(ROLE_USER);
    });

    it("rejects an expiry already in the past", async () => {
      const { access, admin, user, orgId, ROLE_USER } = await loadFixture(staffedFixture);
      const past = BigInt(await time.latest()) - 1n;
      await expect(
        access.connect(admin).assignRole(orgId, user.address, ROLE_USER, past)
      ).to.be.revertedWithCustomError(access, "ExpiryInPast");
    });
  });

  describe("removing members", () => {
    it("removes a member and keeps the enumeration list consistent", async () => {
      const { access, admin, manager, auditor, user, orgId, ROLE_MANAGER, ROLE_NONE } = await loadFixture(
        staffedFixture
      );
      expect(await access.memberCount(orgId)).to.equal(3n);

      await expect(access.connect(admin).removeMember(orgId, manager.address))
        .to.emit(access, "MemberRemoved")
        .withArgs(orgId, manager.address, ROLE_MANAGER, admin.address);

      expect(await access.effectiveRole(orgId, manager.address)).to.equal(ROLE_NONE);
      expect(await access.memberCount(orgId)).to.equal(2n);

      const members = await access.getMembers(orgId);
      expect(members).to.have.lengthOf(2);
      expect(members).to.include(auditor.address);
      expect(members).to.include(user.address);
      expect(members).to.not.include(manager.address);
    });

    it("cannot remove a non-member or yourself", async () => {
      const { access, admin, outsider, orgId } = await loadFixture(staffedFixture);
      await expect(access.connect(admin).removeMember(orgId, outsider.address)).to.be.revertedWithCustomError(
        access,
        "NotMember"
      );
      await expect(access.connect(admin).removeMember(orgId, admin.address)).to.be.revertedWithCustomError(
        access,
        "CannotTargetSelf"
      );
    });

    it("pages members for large organizations", async () => {
      const { access, orgId } = await loadFixture(staffedFixture);
      expect(await access.getMembersPaged(orgId, 0n, 2n)).to.have.lengthOf(2);
      expect(await access.getMembersPaged(orgId, 2n, 10n)).to.have.lengthOf(1);
      expect(await access.getMembersPaged(orgId, 9n, 5n)).to.have.lengthOf(0);
    });
  });

  describe("default permission matrix", () => {
    it("matches the documented baseline", async () => {
      const {
        access,
        admin,
        manager,
        auditor,
        user,
        orgId,
        PERM_MANAGE_MEMBERS,
        PERM_ASSIGN_ROLES,
        PERM_MINT_ASSETS,
        PERM_TRANSFER_ASSETS,
        PERM_VIEW_AUDIT,
        PERM_MANAGE_APPS,
      } = await loadFixture(staffedFixture);

      // ADMIN — everything
      for (const perm of [
        PERM_MANAGE_MEMBERS,
        PERM_ASSIGN_ROLES,
        PERM_MINT_ASSETS,
        PERM_TRANSFER_ASSETS,
        PERM_VIEW_AUDIT,
        PERM_MANAGE_APPS,
      ]) {
        expect(await access.hasPermission(orgId, admin.address, perm), "admin").to.equal(true);
      }

      // MANAGER — move assets and read audit only
      expect(await access.hasPermission(orgId, manager.address, PERM_TRANSFER_ASSETS)).to.equal(true);
      expect(await access.hasPermission(orgId, manager.address, PERM_VIEW_AUDIT)).to.equal(true);
      expect(await access.hasPermission(orgId, manager.address, PERM_MINT_ASSETS)).to.equal(false);
      expect(await access.hasPermission(orgId, manager.address, PERM_ASSIGN_ROLES)).to.equal(false);

      // AUDITOR — read only
      expect(await access.hasPermission(orgId, auditor.address, PERM_VIEW_AUDIT)).to.equal(true);
      expect(await access.hasPermission(orgId, auditor.address, PERM_TRANSFER_ASSETS)).to.equal(false);

      // USER — nothing administrative
      expect(await access.hasPermission(orgId, user.address, PERM_VIEW_AUDIT)).to.equal(false);
      expect(await access.hasPermission(orgId, user.address, PERM_MINT_ASSETS)).to.equal(false);
    });

    it("exposes the pure default matrix for UI preview", async () => {
      const { access, ROLE_MANAGER, PERM_MINT_ASSETS, PERM_TRANSFER_ASSETS } = await loadFixture(deployFixture);
      expect(await access.defaultPermission(ROLE_MANAGER, PERM_TRANSFER_ASSETS)).to.equal(true);
      expect(await access.defaultPermission(ROLE_MANAGER, PERM_MINT_ASSETS)).to.equal(false);
    });
  });

  describe("permission overrides", () => {
    it("an org can grant a manager the right to mint", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER, PERM_MINT_ASSETS } = await loadFixture(staffedFixture);
      expect(await access.hasPermission(orgId, manager.address, PERM_MINT_ASSETS)).to.equal(false);

      await expect(access.connect(admin).setPermission(orgId, ROLE_MANAGER, PERM_MINT_ASSETS, 1))
        .to.emit(access, "PermissionUpdated")
        .withArgs(orgId, ROLE_MANAGER, PERM_MINT_ASSETS, 1, admin.address);

      expect(await access.hasPermission(orgId, manager.address, PERM_MINT_ASSETS)).to.equal(true);
      expect(await access.permissionOverride(orgId, ROLE_MANAGER, PERM_MINT_ASSETS)).to.equal(1);
    });

    it("an org can deny a default permission", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER, PERM_TRANSFER_ASSETS } = await loadFixture(staffedFixture);
      await access.connect(admin).setPermission(orgId, ROLE_MANAGER, PERM_TRANSFER_ASSETS, 2);
      expect(await access.hasPermission(orgId, manager.address, PERM_TRANSFER_ASSETS)).to.equal(false);
    });

    it("only an ADMIN-level caller can reshape permissions", async () => {
      const { access, manager, auditor, orgId, ROLE_USER, PERM_MINT_ASSETS } = await loadFixture(staffedFixture);
      await expect(
        access.connect(manager).setPermission(orgId, ROLE_USER, PERM_MINT_ASSETS, 1)
      ).to.be.revertedWithCustomError(access, "MissingPermission");
      await expect(
        access.connect(auditor).setPermission(orgId, ROLE_USER, PERM_MINT_ASSETS, 1)
      ).to.be.revertedWithCustomError(access, "MissingPermission");
    });

    it("refuses to lock the organization out of its own governance", async () => {
      const { access, admin, orgId, ROLE_ADMIN, PERM_ASSIGN_ROLES, PERM_MANAGE_MEMBERS } = await loadFixture(
        staffedFixture
      );
      await expect(
        access.connect(admin).setPermission(orgId, ROLE_ADMIN, PERM_ASSIGN_ROLES, 2)
      ).to.be.revertedWithCustomError(access, "CannotDisableAdminGovernance");
      await expect(
        access.connect(admin).setPermission(orgId, ROLE_ADMIN, PERM_MANAGE_MEMBERS, 2)
      ).to.be.revertedWithCustomError(access, "CannotDisableAdminGovernance");
    });
  });

  describe("identity revocation cascades", () => {
    it("a revoked identity instantly loses its role and every permission", async () => {
      const { access, registry, platform, manager, orgId, ROLE_NONE, PERM_TRANSFER_ASSETS } = await loadFixture(
        staffedFixture
      );
      expect(await access.hasPermission(orgId, manager.address, PERM_TRANSFER_ASSETS)).to.equal(true);

      await registry.connect(platform).revokeIdentity(manager.address);

      expect(await access.effectiveRole(orgId, manager.address)).to.equal(ROLE_NONE);
      expect(await access.hasPermission(orgId, manager.address, PERM_TRANSFER_ASSETS)).to.equal(false);
      expect(await access.isMember(orgId, manager.address)).to.equal(false);
    });

    it("suspending an organization freezes every permission inside it", async () => {
      const { access, registry, admin, manager, orgId, PERM_TRANSFER_ASSETS, PERM_MINT_ASSETS } = await loadFixture(
        staffedFixture
      );
      await registry.connect(admin).setOrganizationActive(orgId, false);

      expect(await access.hasPermission(orgId, manager.address, PERM_TRANSFER_ASSETS)).to.equal(false);
      expect(await access.hasPermission(orgId, admin.address, PERM_MINT_ASSETS)).to.equal(false);
    });
  });

  describe("application access — the Web2 SSO layer", () => {
    it("registers an application and gates it by role", async () => {
      const { access, admin, manager, user, orgId, ROLE_MANAGER, ROLE_USER } = await loadFixture(staffedFixture);

      await expect(access.connect(admin).registerApplication(orgId, APP_ID, APP_HASH))
        .to.emit(access, "ApplicationRegistered")
        .withArgs(orgId, APP_ID, APP_HASH, admin.address);
      expect(await access.applicationRegistered(orgId, APP_ID)).to.equal(true);

      // nothing is accessible until access is explicitly granted
      expect(await access.canAccessApp(orgId, manager.address, APP_ID)).to.equal(false);

      await expect(access.connect(admin).setAppAccess(orgId, APP_ID, ROLE_MANAGER, true))
        .to.emit(access, "AppAccessChanged")
        .withArgs(orgId, APP_ID, ROLE_MANAGER, true, admin.address);

      expect(await access.canAccessApp(orgId, manager.address, APP_ID)).to.equal(true);
      expect(await access.canAccessApp(orgId, user.address, APP_ID)).to.equal(false);
      expect(await access.appAccessForRole(orgId, APP_ID, ROLE_USER)).to.equal(false);
    });

    it("revoking app access for a role locks out every holder of that role", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER } = await loadFixture(staffedFixture);
      await access.connect(admin).registerApplication(orgId, APP_ID, APP_HASH);
      await access.connect(admin).setAppAccess(orgId, APP_ID, ROLE_MANAGER, true);
      expect(await access.canAccessApp(orgId, manager.address, APP_ID)).to.equal(true);

      await access.connect(admin).setAppAccess(orgId, APP_ID, ROLE_MANAGER, false);
      expect(await access.canAccessApp(orgId, manager.address, APP_ID)).to.equal(false);
    });

    it("a revoked identity is denied even while its role still has app access", async () => {
      const { access, registry, platform, admin, manager, orgId, ROLE_MANAGER } = await loadFixture(staffedFixture);
      await access.connect(admin).registerApplication(orgId, APP_ID, APP_HASH);
      await access.connect(admin).setAppAccess(orgId, APP_ID, ROLE_MANAGER, true);

      await registry.connect(platform).revokeIdentity(manager.address);
      expect(await access.canAccessApp(orgId, manager.address, APP_ID)).to.equal(false);
    });

    it("blocks non-admins from registering apps and rejects duplicates", async () => {
      const { access, admin, manager, orgId, ROLE_MANAGER } = await loadFixture(staffedFixture);
      await expect(
        access.connect(manager).registerApplication(orgId, APP_ID, APP_HASH)
      ).to.be.revertedWithCustomError(access, "MissingPermission");

      await access.connect(admin).registerApplication(orgId, APP_ID, APP_HASH);
      await expect(access.connect(admin).registerApplication(orgId, APP_ID, APP_HASH))
        .to.be.revertedWithCustomError(access, "ApplicationAlreadyRegistered")
        .withArgs(orgId, APP_ID);

      await expect(
        access.connect(admin).setAppAccess(orgId, ethers.id("unknown-app"), ROLE_MANAGER, true)
      ).to.be.revertedWithCustomError(access, "ApplicationNotRegistered");

      await expect(
        access.connect(admin).registerApplication(orgId, ethers.ZeroHash, APP_HASH)
      ).to.be.revertedWithCustomError(access, "EmptyHash");
    });

    it("an unregistered application is never accessible", async () => {
      const { access, admin, orgId } = await loadFixture(staffedFixture);
      expect(await access.canAccessApp(orgId, admin.address, ethers.id("ghost-app"))).to.equal(false);
    });
  });

  describe("views", () => {
    it("exposes membership records and the role list", async () => {
      const { access, manager, orgId, ROLE_MANAGER, ROLE_ADMIN, ROLE_AUDITOR, ROLE_USER } = await loadFixture(
        staffedFixture
      );
      const membership = await access.getMembership(orgId, manager.address);
      expect(membership.role).to.equal(ROLE_MANAGER);
      expect(membership.expiresAt).to.equal(NEVER);
      expect(membership.joinedAt).to.be.greaterThan(0n);

      expect(await access.allRoles()).to.deep.equal([ROLE_ADMIN, ROLE_MANAGER, ROLE_AUDITOR, ROLE_USER]);
      void anyValue;
    });
  });
});
