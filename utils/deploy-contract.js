import { BrowserLocalStorageKeyStore } from 'near-api-js/lib/key_stores';
import { KeyPair, PublicKey } from 'near-api-js/lib/utils';
import { Transaction, createAccount, transfer, addKey, fullAccessKey, deployContract, functionCall, signTransaction } from 'near-api-js/lib/transaction';
import { parseNearAmount } from 'near-api-js/lib/utils/format';
import { InMemorySigner } from 'near-api-js/lib/signer';
import { signTransactionsURL } from './web-wallet-api';
import { base_decode } from 'near-api-js/lib/utils/serialize';


const NETWORK_ID = 'default';
const WALLET_URL = 'https://wallet.near.org';
const FAST_NEAR_URL = 'https://rpc.web4.near.page';
const TEMPLATE_CONTRACT_NAME = 'web4gpt.near'; // TODO: Change to whatever has min contract 

const keyStore = new BrowserLocalStorageKeyStore(window.localStorage, 'deploy');

export async function getDeployInfo({ accountId }) {
    const contractId = `web4.${accountId}`;

    const accountResponse = await fetch(`${FAST_NEAR_URL}/account/${contractId}`);
    if (!accountResponse.ok) return { };
    const account = await accountResponse.json();

    let keyPair = await keyStore.getKey(NETWORK_ID, contractId);
    if (!keyPair) return { account };

    const keyResponse = await fetch(`${FAST_NEAR_URL}/account/${contractId}/key/${keyPair.publicKey}`);
    if (keyResponse.status === 404) {
        // Acccount exists but doesn't have access key
        // TODO: Report message to user? Add key through wallet if possible?
        console.error(`Account ${accountId} exists but doesn't have access key`);
        return { account, keyPair, keyResponse };
    } else if (keyResponse.status !== 200) {
        throw new Error(`Unexpected status code ${keyResponse.status}`);
    }

    return { account, keyPair, keyResponse };
}

export async function deploy({ accountId, staticUrl }) {
    const contractId = `web4.${accountId}`;

    let { account, keyPair, keyResponse } = await getDeployInfo({ accountId });

    if (!keyPair) {
        // Create new key pair
        keyPair = KeyPair.fromRandom('ed25519');
        await keyStore.setKey(NETWORK_ID, contractId, keyPair);
    }

    if (!account) {
        // Create account with necessary access key
        window.location = signTransactionsURL({ walletUrl: WALLET_URL, transactions: [
            new Transaction({
                signerId: accountId,
                publicKey: new PublicKey({ type: 0, data: Buffer.from(new Array(32))}),
                nonce: 0,
                blockHash: Buffer.from(new Array(32)),
                receiverId: contractId,
                actions: [
                    createAccount(),
                    transfer(parseNearAmount('0.5')),
                    addKey(keyPair.publicKey, fullAccessKey()),
                ]
            })
        ], callbackUrl: window.location.href });

        return;
    }

    if (keyResponse.status === 404) {
        // TODO: Report message to user? Add key through wallet if possible?
        throw Error(`Account ${accountId} exists but doesn't have necessary access key`);
    }

    const nonce = parseInt((await keyResponse.json()).nonce) + 1;
    const blockHash = base_decode((await (await fetch(`${FAST_NEAR_URL}/status`)).json()).sync_info.latest_block_hash);
    // TODO: Refactor to use /web4/account call to self when it's setup in prod
    const contractWasm = Buffer.from(await (await fetch(`${FAST_NEAR_URL}/account/${TEMPLATE_CONTRACT_NAME}/contract`)).arrayBuffer());

    // Create transaction to deploy contract
    const transaction = new Transaction({
        signerId: contractId,
        publicKey: keyPair.publicKey,
        nonce,
        blockHash,
        receiverId: contractId,
        actions: [
            deployContract(contractWasm),
            // TODO: Make sure web4-min-contract has setOwner method
            // functionCall('setOwner', { accountId }, 10000000000000, '0'),
            functionCall('web4_setStaticUrl', { url: staticUrl }, 10000000000000, '0'),
        ]
    });

    // Sign transaction
    const signer = new InMemorySigner(keyStore);
    const [, signedTransaction] = await signTransaction(transaction, signer, contractId, NETWORK_ID);
    console.log('signedTransaction', signedTransaction);

    // Post transaction
    const response = await fetch(FAST_NEAR_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'dontcare',
            method: 'broadcast_tx_commit',
            params: [signedTransaction.encode().toString('base64')],
        }),
    });
    const result = await response.json();
    console.log('result', result);
}