import { ethers, network } from "hardhat";

const REQUIRED = ["SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY", "ETHERSCAN_API_KEY"] as const;
const SEPOLIA_CHAIN_ID = 11155111n;

function requireEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      [
        "Sepolia deployment is not ready.",
        `Missing root .env variable(s): ${missing.join(", ")}`,
        "Add them to C:\\Users\\swadh\\ownex\\.env, then rerun npm run deploy:sepolia.",
      ].join("\n"),
    );
  }
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(`preflight-sepolia must run on the sepolia network, got "${network.name}".`);
  }

  requireEnv();

  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`SEPOLIA_RPC_URL connected to chain ${chain.chainId}, expected ${SEPOLIA_CHAIN_ID}.`);
  }

  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, ethers.provider);
  const balance = await ethers.provider.getBalance(wallet.address);

  console.log("Sepolia preflight");
  console.log(`deployer : ${wallet.address}`);
  console.log(`balance  : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error(
      [
        "Deployer has 0 Sepolia ETH.",
        "Fund this throwaway wallet from a Sepolia faucet before deploying:",
        "https://sepoliafaucet.com/",
        "https://www.alchemy.com/faucets/ethereum-sepolia",
        "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
      ].join("\n"),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
