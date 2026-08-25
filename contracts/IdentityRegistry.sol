// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  IdentityRegistry
 * @notice On-chain registry of wallet-bound identities and the organizations
 *         they create. This contract is the root of trust for OwneX: role
 *         and asset contracts consult it to confirm that a wallet maps to an
 *         active identity before allowing any privileged action.
 *
 * @dev    PRIVACY MODEL — no personal data is ever stored here. Only a
 *         `identityHash` (keccak256 of off-chain profile data held encrypted in
 *         Supabase) is written on-chain. Re-hashing the off-chain record and
 *         comparing it against `identityHash` proves the record was not
 *         tampered with, without publishing anything private.
 */
contract IdentityRegistry is Ownable {
    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    struct Identity {
        bytes32 identityHash; // keccak256 of encrypted off-chain profile
        bool exists;
        bool active;
        uint64 registeredAt;
    }

    struct Organization {
        bytes32 metadataHash; // keccak256 of off-chain org record
        address rootAdmin; // permanent bootstrap admin, transferable
        bool active;
        uint64 createdAt;
    }

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    mapping(address wallet => Identity) private _identities;

    /// @notice Accounts allowed to onboard/revoke identities on a user's behalf.
    mapping(address registrar => bool allowed) public isRegistrar;

    mapping(uint256 orgId => Organization) private _organizations;

    /// @notice Total organizations created. Valid ids are 1..organizationCount.
    uint256 public organizationCount;

    // ─────────────────────────────────────────────────────────────
    // Events — these form the immutable audit trail
    // ─────────────────────────────────────────────────────────────

    event IdentityRegistered(address indexed wallet, bytes32 identityHash, address indexed registeredBy, uint64 at);
    event IdentityHashUpdated(address indexed wallet, bytes32 previousHash, bytes32 newHash, address indexed updatedBy);
    event IdentityRevoked(address indexed wallet, address indexed revokedBy);
    event IdentityReactivated(address indexed wallet, address indexed reactivatedBy);
    event RegistrarUpdated(address indexed registrar, bool allowed);

    event OrganizationCreated(uint256 indexed orgId, address indexed rootAdmin, bytes32 metadataHash, uint64 at);
    event OrganizationMetadataUpdated(uint256 indexed orgId, bytes32 previousHash, bytes32 newHash);
    event OrganizationStatusChanged(uint256 indexed orgId, bool active, address indexed changedBy);
    event OrgRootAdminTransferred(uint256 indexed orgId, address indexed previousAdmin, address indexed newAdmin);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error ZeroAddress();
    error EmptyHash();
    error IdentityAlreadyExists(address wallet);
    error IdentityNotFound(address wallet);
    error IdentityNotActive(address wallet);
    error IdentityAlreadyActive(address wallet);
    error NotAuthorizedRegistrar(address caller);
    error OrganizationNotFound(uint256 orgId);
    error NotOrgRootAdmin(uint256 orgId, address caller);

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        // The platform owner is a registrar by default so it can onboard the
        // first organizations before any other registrar exists.
        isRegistrar[initialOwner] = true;
        emit RegistrarUpdated(initialOwner, true);
    }

    // ─────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyRegistrar() {
        if (!isRegistrar[msg.sender]) revert NotAuthorizedRegistrar(msg.sender);
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // Registrar management
    // ─────────────────────────────────────────────────────────────

    /// @notice Grant or revoke the ability to onboard identities for others.
    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        isRegistrar[registrar] = allowed;
        emit RegistrarUpdated(registrar, allowed);
    }

    // ─────────────────────────────────────────────────────────────
    // Identity lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Self-sovereign registration: a wallet registers its own identity.
     * @param  identityHash keccak256 of the off-chain profile record.
     */
    function registerIdentity(bytes32 identityHash) external {
        _register(msg.sender, identityHash);
    }

    /**
     * @notice Admin-driven onboarding of a wallet that has not self-registered.
     * @dev    Registrars cannot forge control of the wallet — they only create
     *         the registry entry. All later authentication still requires the
     *         wallet's own signature.
     */
    function registerIdentityFor(address wallet, bytes32 identityHash) external onlyRegistrar {
        _register(wallet, identityHash);
    }

    function _register(address wallet, bytes32 identityHash) private {
        if (wallet == address(0)) revert ZeroAddress();
        if (identityHash == bytes32(0)) revert EmptyHash();
        if (_identities[wallet].exists) revert IdentityAlreadyExists(wallet);

        _identities[wallet] =
            Identity({identityHash: identityHash, exists: true, active: true, registeredAt: uint64(block.timestamp)});

        emit IdentityRegistered(wallet, identityHash, msg.sender, uint64(block.timestamp));
    }

    /// @notice A wallet rotates its own off-chain profile hash after editing data.
    function updateIdentityHash(bytes32 newHash) external {
        if (newHash == bytes32(0)) revert EmptyHash();
        Identity storage id = _identities[msg.sender];
        if (!id.exists) revert IdentityNotFound(msg.sender);
        if (!id.active) revert IdentityNotActive(msg.sender);

        bytes32 previous = id.identityHash;
        id.identityHash = newHash;
        emit IdentityHashUpdated(msg.sender, previous, newHash, msg.sender);
    }

    /**
     * @notice Deactivate an identity. Callable by the wallet itself or a registrar.
     * @dev    This is the kill switch that drives instant access revocation across
     *         every organization and every integrated application.
     */
    function revokeIdentity(address wallet) external {
        if (msg.sender != wallet && !isRegistrar[msg.sender]) revert NotAuthorizedRegistrar(msg.sender);

        Identity storage id = _identities[wallet];
        if (!id.exists) revert IdentityNotFound(wallet);
        if (!id.active) revert IdentityNotActive(wallet);

        id.active = false;
        emit IdentityRevoked(wallet, msg.sender);
    }

    /// @notice Restore a previously revoked identity.
    function reactivateIdentity(address wallet) external onlyRegistrar {
        Identity storage id = _identities[wallet];
        if (!id.exists) revert IdentityNotFound(wallet);
        if (id.active) revert IdentityAlreadyActive(wallet);

        id.active = true;
        emit IdentityReactivated(wallet, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Organizations
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create an organization. The caller becomes its root admin.
     * @return orgId The new organization id (1-based).
     */
    function createOrganization(bytes32 metadataHash) external returns (uint256 orgId) {
        if (metadataHash == bytes32(0)) revert EmptyHash();
        _requireActiveIdentity(msg.sender);

        orgId = ++organizationCount;
        _organizations[orgId] = Organization({
            metadataHash: metadataHash,
            rootAdmin: msg.sender,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        emit OrganizationCreated(orgId, msg.sender, metadataHash, uint64(block.timestamp));
    }

    function updateOrganizationMetadata(uint256 orgId, bytes32 newHash) external {
        if (newHash == bytes32(0)) revert EmptyHash();
        Organization storage org = _requireOrg(orgId);
        if (org.rootAdmin != msg.sender) revert NotOrgRootAdmin(orgId, msg.sender);

        bytes32 previous = org.metadataHash;
        org.metadataHash = newHash;
        emit OrganizationMetadataUpdated(orgId, previous, newHash);
    }

    /// @notice Suspend or resume an entire organization. Root admin or platform owner.
    function setOrganizationActive(uint256 orgId, bool active) external {
        Organization storage org = _requireOrg(orgId);
        if (org.rootAdmin != msg.sender && owner() != msg.sender) revert NotOrgRootAdmin(orgId, msg.sender);

        org.active = active;
        emit OrganizationStatusChanged(orgId, active, msg.sender);
    }

    /// @notice Hand the root admin seat to another active identity.
    function transferOrgRootAdmin(uint256 orgId, address newAdmin) external {
        if (newAdmin == address(0)) revert ZeroAddress();
        Organization storage org = _requireOrg(orgId);
        if (org.rootAdmin != msg.sender) revert NotOrgRootAdmin(orgId, msg.sender);
        _requireActiveIdentity(newAdmin);

        address previous = org.rootAdmin;
        org.rootAdmin = newAdmin;
        emit OrgRootAdminTransferred(orgId, previous, newAdmin);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    function getIdentity(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }

    /// @notice True only when the wallet is registered AND not revoked.
    function isActive(address wallet) public view returns (bool) {
        Identity storage id = _identities[wallet];
        return id.exists && id.active;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _identities[wallet].exists;
    }

    /// @notice Tamper check: does the off-chain record still match the anchor?
    function verifyIdentityHash(address wallet, bytes32 candidateHash) external view returns (bool) {
        Identity storage id = _identities[wallet];
        return id.exists && id.identityHash == candidateHash;
    }

    function getOrganization(uint256 orgId) external view returns (Organization memory) {
        return _organizations[orgId];
    }

    function organizationExists(uint256 orgId) public view returns (bool) {
        return orgId != 0 && orgId <= organizationCount;
    }

    function isOrganizationActive(uint256 orgId) external view returns (bool) {
        return organizationExists(orgId) && _organizations[orgId].active;
    }

    function orgRootAdmin(uint256 orgId) external view returns (address) {
        return _organizations[orgId].rootAdmin;
    }

    // ─────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────

    function _requireActiveIdentity(address wallet) private view {
        Identity storage id = _identities[wallet];
        if (!id.exists) revert IdentityNotFound(wallet);
        if (!id.active) revert IdentityNotActive(wallet);
    }

    function _requireOrg(uint256 orgId) private view returns (Organization storage org) {
        if (!organizationExists(orgId)) revert OrganizationNotFound(orgId);
        org = _organizations[orgId];
    }
}
