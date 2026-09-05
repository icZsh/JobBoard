import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const SCRYPT_COST = 131_072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
};

function deriveKey(
  password: string,
  salt: string,
  parameters: ScryptParameters,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Admin passwords must contain 12–256 characters.");
  }

  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await deriveKey(password, salt, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  });

  return [
    PASSWORD_HASH_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt,
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string) {
  if (password.length > 256 || encodedHash.split("$").length !== 6)
    return false;
  const [prefix, costValue, blockSizeValue, parallelizationValue, salt, hash] =
    encodedHash.split("$");
  const parameters = {
    cost: Number.parseInt(costValue ?? "", 10),
    blockSize: Number.parseInt(blockSizeValue ?? "", 10),
    parallelization: Number.parseInt(parallelizationValue ?? "", 10),
  };

  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    !salt ||
    !hash ||
    !Number.isInteger(parameters.cost) ||
    !Number.isInteger(parameters.blockSize) ||
    !Number.isInteger(parameters.parallelization) ||
    parameters.cost !== SCRYPT_COST ||
    parameters.blockSize !== SCRYPT_BLOCK_SIZE ||
    parameters.parallelization !== SCRYPT_PARALLELIZATION
  ) {
    return false;
  }

  try {
    const storedKey = Buffer.from(hash, "base64url");

    if (storedKey.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const suppliedKey = await deriveKey(password, salt, parameters);
    return timingSafeEqual(storedKey, suppliedKey);
  } catch {
    return false;
  }
}
