import * as fs from "fs";
import * as path from "path";
import { artifacts } from "hardhat";

/**
 * Copies the ABI of each contract into the platform app so the frontend and
 * route handlers always talk to the current interface.
 *
 * Run after any contract change:
 *   npm run export:abi
 */
const CONTRACTS = ["IdentityRegistry", "OrgAccessManager", "AssetNFT"] as const;
const OUT_DIR = path.join(__dirname, "..", "apps", "platform", "lib", "chain", "abis");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const name of CONTRACTS) {
    const artifact = await artifacts.readArtifact(name);
    const file = path.join(OUT_DIR, `${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(artifact.abi, null, 2)}\n`);
    console.log(`${name.padEnd(18)} ${artifact.abi.length} entries → lib/chain/abis/${name}.json`);
  }

  console.log(`\nexported ${CONTRACTS.length} ABIs`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
