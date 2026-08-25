// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IdentityRegistry} from "./IdentityRegistry.sol";

/**
 * @title  OrgAccessManager
 * @notice Per-organization Role-Based Access Control enforced entirely on-chain.
 *
 * @dev    THREE DESIGN CHOICES THAT MATTER
 *
 *         1. Roles are storage mappings, never transferable tokens. A role NFT
 *            could be sold or moved, which would let anyone buy Manager rights.
 *            Membership here is bound to the wallet and cannot be transferred.
 *
 *         2. Permissions use a tri-state override (Unset / Allowed / Denied) on
 *            top of a sensible default matrix. Organizations get granular
 *            customisation without any contract redeployment, and a fresh org is
 *            immediately usable with zero configuration transactions.
 *
 *         3. Memberships can carry an expiry. Time-bound access means a
 *            contractor's Manager role lapses automatically at a block deadline
 *            instead of relying on somebody remembering to revoke it.
 */
contract OrgAccessManager {
    // ─────────────────────────────────────────────────────────────
    // Roles & permissions
    // ─────────────────────────────────────────────────────────────

    bytes32 public constant ROLE_NONE = bytes32(0);
    bytes32 public constant ROLE_ADMIN = keccak256("OWNEX_ROLE_ADMIN");
    bytes32 public constant ROLE_MANAGER = keccak256("OWNEX_ROLE_MANAGER");
    bytes32 public constant ROLE_AUDITOR = keccak256("OWNEX_ROLE_AUDITOR");
    bytes32 public constant ROLE_USER = keccak256("OWNEX_ROLE_USER");

    bytes32 public constant PERM_MANAGE_MEMBERS = keccak256("PERM_MANAGE_MEMBERS");
    bytes32 public constant PERM_ASSIGN_ROLES = keccak256("PERM_ASSIGN_ROLES");
    bytes32 public constant PERM_MINT_ASSETS = keccak256("PERM_MINT_ASSETS");
    bytes32 public constant PERM_TRANSFER_ASSETS = keccak256("PERM_TRANSFER_ASSETS");
    bytes32 public constant PERM_VIEW_AUDIT = keccak256("PERM_VIEW_AUDIT");
    bytes32 public constant PERM_MANAGE_APPS = keccak256("PERM_MANAGE_APPS");

    enum Override {
        Unset, // fall through to the default matrix
        Allowed,
        Denied
    }

    struct Membership {
        bytes32 role;
        uint64 joinedAt;
        uint64 expiresAt; // 0 = permanent
    }

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    IdentityRegistry public immutable identityRegistry;

    mapping(uint256 orgId => mapping(address wallet => Membership)) private _memberships;
    mapping(uint256 orgId => address[] members) private _memberList;
    mapping(uint256 orgId => mapping(address wallet => uint256 index)) private _memberIndex;

    mapping(uint256 orgId => mapping(bytes32 role => mapping(bytes32 permission => Override))) private _permissionOverride;

    /// @notice Off-chain record hash for each registered application, per org.
    mapping(uint256 orgId => mapping(bytes32 appId => bytes32 metadataHash)) public applicationMetadata;
    mapping(uint256 orgId => mapping(bytes32 appId => bool)) public applicationRegistered;
    mapping(uint256 orgId => mapping(bytes32 appId => mapping(bytes32 role => bool))) private _appRoleAccess;

    // ─────────────────────────────────────────────────────────────
    // Events — the audit trail
    // ─────────────────────────────────────────────────────────────

    event MemberAdded(uint256 indexed orgId, address indexed wallet, bytes32 role, uint64 expiresAt, address indexed by);
    event MemberRemoved(uint256 indexed orgId, address indexed wallet, bytes32 previousRole, address indexed by);
    event RoleAssigned(
        uint256 indexed orgId, address indexed wallet, bytes32 previousRole, bytes32 newRole, uint64 expiresAt, address indexed by
    );
    event RoleExpiryUpdated(uint256 indexed orgId, address indexed wallet, uint64 previousExpiry, uint64 newExpiry, address indexed by);
    event PermissionUpdated(uint256 indexed orgId, bytes32 role, bytes32 permission, Override state, address indexed by);
    event ApplicationRegistered(uint256 indexed orgId, bytes32 indexed appId, bytes32 metadataHash, address indexed by);
    event AppAccessChanged(uint256 indexed orgId, bytes32 indexed appId, bytes32 role, bool allowed, address indexed by);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error ZeroAddress();
    error EmptyHash();
    error OrganizationNotFound(uint256 orgId);
    error OrganizationSuspended(uint256 orgId);
    error IdentityNotActive(address wallet);
    error InvalidRole(bytes32 role);
    error AlreadyMember(uint256 orgId, address wallet);
    error NotMember(uint256 orgId, address wallet);
    error MissingPermission(uint256 orgId, address caller, bytes32 permission);
    error CannotTargetSelf();
    error CannotModifyRootAdmin(uint256 orgId);
    error CannotDisableAdminGovernance();
    error ExpiryInPast(uint64 expiresAt);
    error ApplicationNotRegistered(uint256 orgId, bytes32 appId);
    error ApplicationAlreadyRegistered(uint256 orgId, bytes32 appId);

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = IdentityRegistry(identityRegistry_);
    }

    // ─────────────────────────────────────────────────────────────
    // Membership management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Add a wallet to an organization with a role.
     * @param  expiresAt Unix seconds after which the role lapses; 0 = permanent.
     */
    function addMember(uint256 orgId, address wallet, bytes32 role, uint64 expiresAt) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_MANAGE_MEMBERS);
        if (wallet == address(0)) revert ZeroAddress();
        if (!_isValidRole(role)) revert InvalidRole(role);
        if (!identityRegistry.isActive(wallet)) revert IdentityNotActive(wallet);
        if (_memberships[orgId][wallet].role != ROLE_NONE) revert AlreadyMember(orgId, wallet);
        _requireFutureExpiry(expiresAt);

        _memberships[orgId][wallet] =
            Membership({role: role, joinedAt: uint64(block.timestamp), expiresAt: expiresAt});

        _memberIndex[orgId][wallet] = _memberList[orgId].length;
        _memberList[orgId].push(wallet);

        emit MemberAdded(orgId, wallet, role, expiresAt, msg.sender);
        emit RoleAssigned(orgId, wallet, ROLE_NONE, role, expiresAt, msg.sender);
    }

    /**
     * @notice Change an existing member's role.
     * @dev    Self-targeting is blocked so no one can promote themselves, and the
     *         root admin's seat cannot be altered here — it moves only through
     *         IdentityRegistry.transferOrgRootAdmin.
     */
    function assignRole(uint256 orgId, address wallet, bytes32 role, uint64 expiresAt) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_ASSIGN_ROLES);
        if (wallet == msg.sender) revert CannotTargetSelf();
        if (wallet == identityRegistry.orgRootAdmin(orgId)) revert CannotModifyRootAdmin(orgId);
        if (!_isValidRole(role)) revert InvalidRole(role);
        if (!identityRegistry.isActive(wallet)) revert IdentityNotActive(wallet);
        _requireFutureExpiry(expiresAt);

        Membership storage m = _memberships[orgId][wallet];
        if (m.role == ROLE_NONE) revert NotMember(orgId, wallet);

        bytes32 previous = m.role;
        m.role = role;
        m.expiresAt = expiresAt;

        emit RoleAssigned(orgId, wallet, previous, role, expiresAt, msg.sender);
    }

    /// @notice Extend or shorten a member's time-bound access.
    function setRoleExpiry(uint256 orgId, address wallet, uint64 expiresAt) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_ASSIGN_ROLES);
        if (wallet == identityRegistry.orgRootAdmin(orgId)) revert CannotModifyRootAdmin(orgId);
        _requireFutureExpiry(expiresAt);

        Membership storage m = _memberships[orgId][wallet];
        if (m.role == ROLE_NONE) revert NotMember(orgId, wallet);

        uint64 previous = m.expiresAt;
        m.expiresAt = expiresAt;
        emit RoleExpiryUpdated(orgId, wallet, previous, expiresAt, msg.sender);
    }

    /// @notice Remove a wallet from the organization entirely.
    function removeMember(uint256 orgId, address wallet) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_MANAGE_MEMBERS);
        if (wallet == msg.sender) revert CannotTargetSelf();
        if (wallet == identityRegistry.orgRootAdmin(orgId)) revert CannotModifyRootAdmin(orgId);

        Membership storage m = _memberships[orgId][wallet];
        if (m.role == ROLE_NONE) revert NotMember(orgId, wallet);

        bytes32 previous = m.role;
        delete _memberships[orgId][wallet];

        // swap-and-pop out of the enumeration list
        uint256 idx = _memberIndex[orgId][wallet];
        address[] storage list = _memberList[orgId];
        address last = list[list.length - 1];
        list[idx] = last;
        _memberIndex[orgId][last] = idx;
        list.pop();
        delete _memberIndex[orgId][wallet];

        emit MemberRemoved(orgId, wallet, previous, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Permission matrix
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Override the default permission matrix for one role in one org.
     * @dev    Only ADMIN-level callers may reshape permissions, and the guard
     *         below prevents an org from removing ADMIN's ability to assign
     *         roles, which would permanently lock the organization out.
     */
    function setPermission(uint256 orgId, bytes32 role, bytes32 permission, Override state) external {
        _requireActiveOrg(orgId);
        if (effectiveRole(orgId, msg.sender) != ROLE_ADMIN) {
            revert MissingPermission(orgId, msg.sender, PERM_ASSIGN_ROLES);
        }
        if (!_isValidRole(role)) revert InvalidRole(role);

        bool disablingAdminGovernance = role == ROLE_ADMIN
            && (permission == PERM_ASSIGN_ROLES || permission == PERM_MANAGE_MEMBERS) && state == Override.Denied;
        if (disablingAdminGovernance) revert CannotDisableAdminGovernance();

        _permissionOverride[orgId][role][permission] = state;
        emit PermissionUpdated(orgId, role, permission, state, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Application access (the Web2 SSO layer)
    // ─────────────────────────────────────────────────────────────

    function registerApplication(uint256 orgId, bytes32 appId, bytes32 metadataHash) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_MANAGE_APPS);
        if (appId == bytes32(0) || metadataHash == bytes32(0)) revert EmptyHash();
        if (applicationRegistered[orgId][appId]) revert ApplicationAlreadyRegistered(orgId, appId);

        applicationRegistered[orgId][appId] = true;
        applicationMetadata[orgId][appId] = metadataHash;
        emit ApplicationRegistered(orgId, appId, metadataHash, msg.sender);
    }

    function setAppAccess(uint256 orgId, bytes32 appId, bytes32 role, bool allowed) external {
        _requireActiveOrg(orgId);
        _requirePermission(orgId, msg.sender, PERM_MANAGE_APPS);
        if (!applicationRegistered[orgId][appId]) revert ApplicationNotRegistered(orgId, appId);
        if (!_isValidRole(role)) revert InvalidRole(role);

        _appRoleAccess[orgId][appId][role] = allowed;
        emit AppAccessChanged(orgId, appId, role, allowed, msg.sender);
    }

    /// @notice The single call an integrated Web2 application makes to gate login.
    function canAccessApp(uint256 orgId, address wallet, bytes32 appId) external view returns (bool) {
        if (!applicationRegistered[orgId][appId]) return false;
        if (!identityRegistry.isOrganizationActive(orgId)) return false;
        bytes32 role = effectiveRole(orgId, wallet);
        if (role == ROLE_NONE) return false;
        return _appRoleAccess[orgId][appId][role];
    }

    function appAccessForRole(uint256 orgId, bytes32 appId, bytes32 role) external view returns (bool) {
        return _appRoleAccess[orgId][appId][role];
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice The role that actually applies right now.
     * @dev    Returns ROLE_NONE when the identity is revoked, the membership has
     *         expired, or the wallet was never a member. The root admin always
     *         resolves to ADMIN so an organization can never be orphaned.
     */
    function effectiveRole(uint256 orgId, address wallet) public view returns (bytes32) {
        if (!identityRegistry.isActive(wallet)) return ROLE_NONE;
        if (identityRegistry.orgRootAdmin(orgId) == wallet) return ROLE_ADMIN;

        Membership storage m = _memberships[orgId][wallet];
        if (m.role == ROLE_NONE) return ROLE_NONE;
        if (m.expiresAt != 0 && m.expiresAt <= block.timestamp) return ROLE_NONE;
        return m.role;
    }

    function getMembership(uint256 orgId, address wallet) external view returns (Membership memory) {
        return _memberships[orgId][wallet];
    }

    function isMember(uint256 orgId, address wallet) external view returns (bool) {
        return effectiveRole(orgId, wallet) != ROLE_NONE;
    }

    function memberCount(uint256 orgId) external view returns (uint256) {
        return _memberList[orgId].length;
    }

    function getMembers(uint256 orgId) external view returns (address[] memory) {
        return _memberList[orgId];
    }

    /// @notice Paged member enumeration for dashboards with large organizations.
    function getMembersPaged(uint256 orgId, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        address[] storage list = _memberList[orgId];
        if (offset >= list.length) return new address[](0);
        uint256 end = offset + limit;
        if (end > list.length) end = list.length;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = list[i];
        }
    }

    /// @notice The authoritative permission check used by this and other contracts.
    function hasPermission(uint256 orgId, address wallet, bytes32 permission) public view returns (bool) {
        if (!identityRegistry.isOrganizationActive(orgId)) return false;
        bytes32 role = effectiveRole(orgId, wallet);
        if (role == ROLE_NONE) return false;

        Override state = _permissionOverride[orgId][role][permission];
        if (state == Override.Allowed) return true;
        if (state == Override.Denied) return false;
        return _defaultPermission(role, permission);
    }

    function permissionOverride(uint256 orgId, bytes32 role, bytes32 permission) external view returns (Override) {
        return _permissionOverride[orgId][role][permission];
    }

    /// @notice The zero-configuration baseline every new organization starts with.
    function defaultPermission(bytes32 role, bytes32 permission) external pure returns (bool) {
        return _defaultPermission(role, permission);
    }

    function allRoles() external pure returns (bytes32[4] memory) {
        return [ROLE_ADMIN, ROLE_MANAGER, ROLE_AUDITOR, ROLE_USER];
    }

    // ─────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────

    function _defaultPermission(bytes32 role, bytes32 permission) private pure returns (bool) {
        if (role == ROLE_ADMIN) {
            return permission == PERM_MANAGE_MEMBERS || permission == PERM_ASSIGN_ROLES
                || permission == PERM_MINT_ASSETS || permission == PERM_TRANSFER_ASSETS
                || permission == PERM_VIEW_AUDIT || permission == PERM_MANAGE_APPS;
        }
        if (role == ROLE_MANAGER) {
            // Managers move assets and read audit history, but cannot mint new
            // assets or reshape the organization's roles.
            return permission == PERM_TRANSFER_ASSETS || permission == PERM_VIEW_AUDIT;
        }
        if (role == ROLE_AUDITOR) {
            return permission == PERM_VIEW_AUDIT;
        }
        // ROLE_USER holds no administrative permission by default.
        return false;
    }

    function _isValidRole(bytes32 role) private pure returns (bool) {
        return role == ROLE_ADMIN || role == ROLE_MANAGER || role == ROLE_AUDITOR || role == ROLE_USER;
    }

    function _requireActiveOrg(uint256 orgId) private view {
        if (!identityRegistry.organizationExists(orgId)) revert OrganizationNotFound(orgId);
        if (!identityRegistry.isOrganizationActive(orgId)) revert OrganizationSuspended(orgId);
    }

    function _requirePermission(uint256 orgId, address caller, bytes32 permission) private view {
        if (!hasPermission(orgId, caller, permission)) revert MissingPermission(orgId, caller, permission);
    }

    function _requireFutureExpiry(uint64 expiresAt) private view {
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert ExpiryInPast(expiresAt);
    }
}
