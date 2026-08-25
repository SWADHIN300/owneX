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
  console.log(`IdentityRegistry  ${identityRegistryAddress}`);

  const accessManager = await ethers.deployContract("OrgAccessManager", [identityRegistryAddress]);
  await accessManager.waitForDeployment();
  const accessManagerAddress = await accessManager.getAddress();
  console.log(`OrgAccessManager  ${accessManagerAddress}`);

  const assetNFT = await ethers.deployContract("AssetNFT", [
    identityRegistryAddress,
    accessManagerAddress,
    deployer.address,
  ]);
  await assetNFT.waitForDeployment();
  const assetNFTAddress = await assetNFT.getAddress();
  console.log(`AssetNFT          ${assetNFTAddress}`);

  // Let the platform admin wallet onboard identities without being the deployer.
  if (platformAdmin.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await identityRegistry.setRegistrar(platformAdmin, true);
    await tx.wait();
    console.log(`\nregistrar granted to ${platformAdmin}`);
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
