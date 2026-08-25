// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {IdentityRegistry} from "./IdentityRegistry.sol";
import {OrgAccessManager} from "./OrgAccessManager.sol";

/**
 * @title  AssetNFT
 * @notice ERC-721 asset certificates owned by organizations and held by the
 *         identities they are assigned to.
 *
 * @dev    WHY THESE TOKENS ARE NOT FREELY TRADEABLE
 *
 *         A company laptop is not a collectible. If an employee could sell the
 *         NFT representing it, on-chain ownership would immediately stop
 *         reflecting reality. So holder-initiated transfers revert: movement
 *         happens only through `reassignAsset` / `revokeAsset`, which require an
 *         organization permission. The employee still holds the token in their
 *         own wallet and can prove custody — they simply cannot alienate it.
 *
 *         PRIVACY — only `assetHash` (keccak256 of the confidential asset record
 *         held encrypted off-chain) and a metadata URI are stored on-chain.
 *         Serial numbers and documents never touch the chain.
 */
contract AssetNFT is ERC721, ERC721Enumerable, ERC721URIStorage, Ownable, Pausable {
    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    struct Asset {
        uint256 orgId;
        bytes32 assetHash; // keccak256 of the encrypted off-chain asset record
        address assignedTo; // current custodian identity
        bool active; // false once revoked
        uint64 mintedAt;
        uint32 transferCount; // provenance depth, cheap to read in a dashboard
    }

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    IdentityRegistry public immutable identityRegistry;
    OrgAccessManager public immutable accessManager;

    uint256 private _nextTokenId = 1;

    mapping(uint256 tokenId => Asset) private _assets;
    mapping(uint256 orgId => uint256[] tokenIds) private _orgAssets;

    /// @dev Set only for the duration of an organization-authorised movement.
    bool private _orgControlledTransfer;

    // ─────────────────────────────────────────────────────────────
    // Events — the audit trail
    // ─────────────────────────────────────────────────────────────

    event AssetMinted(
        uint256 indexed tokenId,
        uint256 indexed orgId,
        address indexed assignedTo,
        bytes32 assetHash,
        string metadataURI,
        address by
    );
    event AssetAssigned(uint256 indexed tokenId, address indexed previousHolder, address indexed newHolder, address by);
    event AssetRevoked(uint256 indexed tokenId, address indexed previousHolder, address custodian, address by);
    event AssetRestored(uint256 indexed tokenId, address indexed assignedTo, address by);
    event AssetMetadataUpdated(uint256 indexed tokenId, bytes32 previousHash, bytes32 newHash, string metadataURI, address by);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error ZeroAddress();
    error EmptyHash();
    error EmptyURI();
    error UnknownAsset(uint256 tokenId);
    error AssetInactive(uint256 tokenId);
    error AssetAlreadyActive(uint256 tokenId);
    error MissingPermission(uint256 orgId, address caller, bytes32 permission);
    error RecipientNotOrgMember(uint256 orgId, address wallet);
    error TransfersLocked(uint256 tokenId);
    error AlreadyAssignedTo(address wallet);

    constructor(address identityRegistry_, address accessManager_, address initialOwner)
        ERC721("OwneX Asset Certificate", "OWNX")
        Ownable(initialOwner)
    {
        if (identityRegistry_ == address(0) || accessManager_ == address(0) || initialOwner == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IdentityRegistry(identityRegistry_);
        accessManager = OrgAccessManager(accessManager_);
    }

    // ─────────────────────────────────────────────────────────────
    // Minting
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Mint an asset certificate and assign it to an organization member.
     * @param  orgId       Organization the asset belongs to.
     * @param  assignedTo  Member who will hold the certificate.
     * @param  assetHash   keccak256 of the confidential off-chain asset record.
     * @param  metadataURI Public, display-safe metadata JSON location.
     */
    function mintAsset(uint256 orgId, address assignedTo, bytes32 assetHash, string calldata metadataURI)
        external
        whenNotPaused
        returns (uint256 tokenId)
    {
        _requirePermission(orgId, msg.sender, accessManager.PERM_MINT_ASSETS());
        if (assignedTo == address(0)) revert ZeroAddress();
        if (assetHash == bytes32(0)) revert EmptyHash();
        if (bytes(metadataURI).length == 0) revert EmptyURI();
        _requireOrgMember(orgId, assignedTo);

        tokenId = _nextTokenId++;
        _assets[tokenId] = Asset({
            orgId: orgId,
            assetHash: assetHash,
            assignedTo: assignedTo,
            active: true,
            mintedAt: uint64(block.timestamp),
            transferCount: 0
        });
        _orgAssets[orgId].push(tokenId);

        _safeMint(assignedTo, tokenId);
        _setTokenURI(tokenId, metadataURI);

        emit AssetMinted(tokenId, orgId, assignedTo, assetHash, metadataURI, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Organization-controlled movement
    // ─────────────────────────────────────────────────────────────

    /// @notice Move an asset to another member of the same organization.
    function reassignAsset(uint256 tokenId, address newHolder) external whenNotPaused {
        Asset storage asset = _requireAsset(tokenId);
        if (!asset.active) revert AssetInactive(tokenId);
        if (newHolder == address(0)) revert ZeroAddress();

        _requirePermission(asset.orgId, msg.sender, accessManager.PERM_TRANSFER_ASSETS());
        _requireOrgMember(asset.orgId, newHolder);

        address previousHolder = ownerOf(tokenId);
        if (previousHolder == newHolder) revert AlreadyAssignedTo(newHolder);

        asset.assignedTo = newHolder;
        asset.transferCount += 1;

        _orgControlledTransfer = true;
        _transfer(previousHolder, newHolder, tokenId);
        _orgControlledTransfer = false;

        emit AssetAssigned(tokenId, previousHolder, newHolder, msg.sender);
    }

    /**
     * @notice Revoke an asset: mark it inactive and pull custody back to the
     *         organization's root admin. Used on offboarding or loss.
     */
    function revokeAsset(uint256 tokenId) external whenNotPaused {
        Asset storage asset = _requireAsset(tokenId);
        if (!asset.active) revert AssetInactive(tokenId);

        _requirePermission(asset.orgId, msg.sender, accessManager.PERM_TRANSFER_ASSETS());

        address previousHolder = ownerOf(tokenId);
        address custodian = identityRegistry.orgRootAdmin(asset.orgId);

        asset.active = false;
        asset.assignedTo = custodian;

        if (previousHolder != custodian) {
            asset.transferCount += 1;
            _orgControlledTransfer = true;
            _transfer(previousHolder, custodian, tokenId);
            _orgControlledTransfer = false;
        }

        emit AssetRevoked(tokenId, previousHolder, custodian, msg.sender);
    }

    /// @notice Return a revoked asset to service, assigning it to a member.
    function restoreAsset(uint256 tokenId, address assignedTo) external whenNotPaused {
        Asset storage asset = _requireAsset(tokenId);
        if (asset.active) revert AssetAlreadyActive(tokenId);
        if (assignedTo == address(0)) revert ZeroAddress();

        _requirePermission(asset.orgId, msg.sender, accessManager.PERM_TRANSFER_ASSETS());
        _requireOrgMember(asset.orgId, assignedTo);

        asset.active = true;
        asset.assignedTo = assignedTo;

        address currentHolder = ownerOf(tokenId);
        if (currentHolder != assignedTo) {
            asset.transferCount += 1;
            _orgControlledTransfer = true;
            _transfer(currentHolder, assignedTo, tokenId);
            _orgControlledTransfer = false;
        }

        emit AssetRestored(tokenId, assignedTo, msg.sender);
    }

    /// @notice Re-anchor an asset after its off-chain record legitimately changes.
    function updateAssetRecord(uint256 tokenId, bytes32 newAssetHash, string calldata metadataURI) external whenNotPaused {
        Asset storage asset = _requireAsset(tokenId);
        if (newAssetHash == bytes32(0)) revert EmptyHash();
        if (bytes(metadataURI).length == 0) revert EmptyURI();

        _requirePermission(asset.orgId, msg.sender, accessManager.PERM_MINT_ASSETS());

        bytes32 previous = asset.assetHash;
        asset.assetHash = newAssetHash;
        _setTokenURI(tokenId, metadataURI);

        emit AssetMetadataUpdated(tokenId, previous, newAssetHash, metadataURI, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Emergency controls (platform level)
    // ─────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────
    // Verification views — what third parties call
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Full ownership check in one call: the claimant holds the token, the
     *         asset is active, their identity is live, and they are still a member
     *         of the owning organization.
     */
    function verifyOwnership(uint256 tokenId, address claimant) external view returns (bool) {
        Asset storage asset = _assets[tokenId];
        if (asset.orgId == 0) return false;
        if (!asset.active) return false;
        if (_ownerOf(tokenId) != claimant) return false;
        if (!identityRegistry.isActive(claimant)) return false;
        if (!identityRegistry.isOrganizationActive(asset.orgId)) return false;
        return accessManager.effectiveRole(asset.orgId, claimant) != accessManager.ROLE_NONE();
    }

    /// @notice Tamper check: does the off-chain asset record still hash to the anchor?
    function verifyAssetHash(uint256 tokenId, bytes32 candidateHash) external view returns (bool) {
        Asset storage asset = _assets[tokenId];
        return asset.orgId != 0 && asset.assetHash == candidateHash;
    }

    function getAsset(uint256 tokenId) external view returns (Asset memory) {
        return _assets[tokenId];
    }

    function assetsOfOrganization(uint256 orgId) external view returns (uint256[] memory) {
        return _orgAssets[orgId];
    }

    function organizationAssetCount(uint256 orgId) external view returns (uint256) {
        return _orgAssets[orgId].length;
    }

    /// @notice All token ids held by a wallet — powers "My Assets" with no indexer.
    function assetsOfHolder(address holder) external view returns (uint256[] memory tokenIds) {
        uint256 count = balanceOf(holder);
        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(holder, i);
        }
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ─────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────

    function _requireAsset(uint256 tokenId) private view returns (Asset storage asset) {
        asset = _assets[tokenId];
        if (asset.orgId == 0) revert UnknownAsset(tokenId);
    }

    function _requirePermission(uint256 orgId, address caller, bytes32 permission) private view {
        if (!accessManager.hasPermission(orgId, caller, permission)) {
            revert MissingPermission(orgId, caller, permission);
        }
    }

    function _requireOrgMember(uint256 orgId, address wallet) private view {
        if (accessManager.effectiveRole(orgId, wallet) == accessManager.ROLE_NONE()) {
            revert RecipientNotOrgMember(orgId, wallet);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ERC-721 hooks — the transfer lock lives here
    // ─────────────────────────────────────────────────────────────

    /**
     * @dev Mint and burn pass through. Every other movement must be flagged as
     *      organization-controlled, which only `reassignAsset`, `revokeAsset`,
     *      and `restoreAsset` can do — and those are permission-gated.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        if (!isMint && !isBurn && !_orgControlledTransfer) {
            revert TransfersLocked(tokenId);
        }
        if (!isMint) {
            _requireNotPaused();
        }

        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
