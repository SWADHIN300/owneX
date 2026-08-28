import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the OwneX contract set.
 *
 *   IdentityRegistry  → root of trust (identities + organizations)
 *   OrgAccessManager  → per-org RBAC, reads IdentityRegistry
 *   AssetNFT          → asset certificates, reads both of the above
 *
 * The platform admin address (defaults to the project wallet) is registered as
 * a registrar so it can onboard identities from MetaMask straight after deploy.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const platformAdmin = process.env.PLATFORM_ADMIN_ADDRESS ?? deployer.address;

  console.log("─".repeat(64));
  console.log(`network        : ${network.name}`);
  console.log(`deployer       : ${deployer.address}`);
  console.log(`balance        : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`platform admin : ${platformAdmin}`);
  console.log("─".repeat(64));

  const identityRegistry = await ethers.deployContract("IdentityRegistry", [deployer.address]);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  const identityRegistryTx = identityRegistry.deploymentTransaction()?.hash ?? null;
  console.log(`IdentityRegistry  ${identityRegistryAddress}`);
  if (identityRegistryTx) console.log(`  tx ${identityRegistryTx}`);

  const accessManager = await ethers.deployContract("OrgAccessManager", [identityRegistryAddress]);
  await accessManager.waitForDeployment();
  const accessManagerAddress = await accessManager.getAddress();
  const accessManagerTx = accessManager.deploymentTransaction()?.hash ?? null;
  console.log(`OrgAccessManager  ${accessManagerAddress}`);
  if (accessManagerTx) console.log(`  tx ${accessManagerTx}`);

  const assetNFT = await ethers.deployContract("AssetNFT", [
    identityRegistryAddress,
    accessManagerAddress,
    deployer.address,
  ]);
  await assetNFT.waitForDeployment();
  const assetNFTAddress = await assetNFT.getAddress();
  const assetNFTTx = assetNFT.deploymentTransaction()?.hash ?? null;
  console.log(`AssetNFT          ${assetNFTAddress}`);
  if (assetNFTTx) console.log(`  tx ${assetNFTTx}`);

  // Let the platform admin wallet onboard identities without being the deployer.
  let registrarTx: string | null = null;
  if (platformAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await identityRegistry.setRegistrar(platformAdmin, true);
    await tx.wait();
    registrarTx = tx.hash;
    console.log(`\nregistrar granted to ${platformAdmin}`);
    console.log(`  tx ${registrarTx}`);
  }

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    platformAdmin,
    contracts: {
      IdentityRegistry: identityRegistryAddress,
      OrgAccessManager: accessManagerAddress,
      AssetNFT: assetNFTAddress,
    },
    transactions: {
      IdentityRegistry: identityRegistryTx,
      OrgAccessManager: accessManagerTx,
      AssetNFT: assetNFTTx,
      registrarGrant: registrarTx,
    },
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nsaved → deployments/${network.name}.json`);
  console.log("\nadd these to your .env:");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`);
  console.log(`ORG_ACCESS_MANAGER_ADDRESS=${accessManagerAddress}`);
  console.log(`ASSET_NFT_ADDRESS=${assetNFTAddress}`);
  if (network.name === "sepolia") {
    console.log("\nSepolia Etherscan:");
    console.log(`IdentityRegistry  https://sepolia.etherscan.io/address/${identityRegistryAddress}`);
    console.log(`OrgAccessManager  https://sepolia.etherscan.io/address/${accessManagerAddress}`);
    console.log(`AssetNFT          https://sepolia.etherscan.io/address/${assetNFTAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
