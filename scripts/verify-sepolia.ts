import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

type Deployment = {
  deployer: string;
  contracts: {
    IdentityRegistry: string;
    OrgAccessManager: string;
    AssetNFT: string;
  };
};

async function verify(name: string, address: string, constructorArguments: unknown[]) {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`${name.padEnd(18)} verified  https://sepolia.etherscan.io/address/${address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`${name.padEnd(18)} already verified  https://sepolia.etherscan.io/address/${address}`);
      return;
    }
    throw error;
  }
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY?.trim()) {
    throw new Error("Missing ETHERSCAN_API_KEY in root .env.");
  }

  const file = path.join(__dirname, "..", "deployments", "sepolia.json");
  if (!fs.existsSync(file)) {
    throw new Error("No deployments/sepolia.json found. Run npm run deploy:sepolia first.");
  }

  const deployment = JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
  const { IdentityRegistry, OrgAccessManager, AssetNFT } = deployment.contracts;

  await verify("IdentityRegistry", IdentityRegistry, [deployment.deployer]);
  await verify("OrgAccessManager", OrgAccessManager, [IdentityRegistry]);
  await verify("AssetNFT", AssetNFT, [IdentityRegistry, OrgAccessManager, deployment.deployer]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
