import axios from 'axios';
import Vault from 'node-vault';

import logger from './logUtil.js'

const WHO = 'user-manager';
const WHO2 = 'gestore-utente';

// loop in attesa che Vault sia disponibile
async function waitVaultUnsealedAndLogIn(vaultUrl, roleID, secretID) {
  while (true) {
    try {
      const response = await axios.get(`${vaultUrl}/v1/sys/health`);
      if (response.status === 200 && response.data.sealed === false && response.data.initialized === true) {
        const vault = Vault({
          apiVersion: 'v1',
          endpoint: vaultUrl
        });
        const login = await vault.approleLogin({
          role_id: roleID,
          secret_id: secretID,
        });
        vault.token = login.auth.client_token;
        return vault;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ottiene i segreti da Vault
export async function getVaultSecrets(vaultUrl, roleID, secretID) {
  try {
    const vaultRef = await waitVaultUnsealedAndLogIn(vaultUrl, roleID, secretID);
    logger.info("Vault unsealed.");
    logger.info("Vault secrets asked");
    const shared = (await vaultRef.read("uninastream/shared")).data;
    const personal = (await vaultRef.read("uninastream/"+WHO)).data;
    return { shared, personal };
  } catch (error) {
    logger.fatal("Server error on vault connection! specific error: "+error);
    console.error(error);
  }
};

// ottiene credenziali di accesso al db
export async function getVaultDBCredentials(vaultUrl, roleID, secretID) {
  logger.info("Vault DB credentials asked");
  try {
    const vaultRef = await waitVaultUnsealedAndLogIn(vaultUrl, roleID, secretID);
    const db = (await vaultRef.read("database/creds/"+WHO2)).data; 
    return db;
  } catch (error) {
    logger.fatal("Server error on vault connection! specific error: "+error);
    console.error(error);
  }
};
