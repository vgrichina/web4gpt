import timeoutSignal from 'timeout-signal';
import { cidToString, packCID, writePBNode } from 'fast-ipfs';
import { CODEC_RAW, CODEC_DAG_PB } from 'fast-ipfs';
import sha256 from 'js-sha256';

const computeHash = (data) => Buffer.from(sha256.arrayBuffer(data));
// TODO: Refactor with code in nearfs, extract to separate package

const DEFAULT_OPTIONS = {
    log: console.log,
    timeout: 2500,
    retryCount: 3,
    gatewayUrl: 'https://ipfs.web4.near.page',
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function isAlreadyUploaded(cid, { log, timeout, retryCount, gatewayUrl } = DEFAULT_OPTIONS) {
    const cid32 = cidToString(cid);
    const urlToCheck = `${gatewayUrl}/ipfs/${cid32}`;
    for (let i = 0; i < retryCount; i++) {
        try {
            const res = await fetch(urlToCheck, { method: 'HEAD', signal: timeoutSignal(timeout) });
            if (res.status === 200) {
                log('Block', cid32, 'already exists on chain, skipping');
                return true;
            }

            if (res.status !== 404) {
                throw new Error(`Unexpected status code ${res.status} for ${urlToCheck}`);
            }
        } catch (e) {
            // Handle AbortError
            if (e.name === 'AbortError') {
                log('Timeout while checking', urlToCheck);
                continue;
            }
            throw e;
        }
    }

    return false;
}

function splitOnBatches(newBlocks) {
    let currentBatch = [];
    const batches = [currentBatch];
    const MAX_BATCH_ACTIONS = 7;
    const MAX_BATCH_BYTES = 256 * 1024;
    for (let { data } of newBlocks) {
        if (currentBatch.length >= MAX_BATCH_ACTIONS || currentBatch.reduce((a, b) => a + b.length, 0) >= MAX_BATCH_BYTES) {
            currentBatch = [];
            batches.push(currentBatch);
        }

        currentBatch.push(data);
    }
    return batches;
}

function isExpectedUploadError(e) {
    return e.message.includes('Cannot find contract code for account') || e.message.includes('Contract method is not found');
}

async function uploadBlocks(blocks, options = DEFAULT_OPTIONS) {
    const { log } = options;

    const TRHOTTLE_MS = 25;
    const blocksAndStatus = (await Promise.all(blocks.map(async ({ data, cid }, i) => ({ data, cid, uploaded: (await sleep(i * TRHOTTLE_MS), await isAlreadyUploaded(cid, options)) }))));
    const batches = splitOnBatches(blocksAndStatus.filter(({ uploaded }) => !uploaded));

    let totalBlocks = batches.reduce((a, b) => a + b.length, 0);
    let currentBlocks = 0;
    for (let batch of batches) {
        for (let data of batch) {
            try {
                // TODO: Pass web4 gateway URL and contract name
                await fetch('/web4/contract/web4gpt.near/fs_store', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                    },
                    body: data,
                });
            } catch (e) {
                if (!isExpectedUploadError(e)) {
                    throw e;
                }
            }
            currentBlocks++;
            log(`Uploaded ${currentBlocks} / ${totalBlocks} blocks to NEARFS`);
        }
    }
}

export async function uploadFiles(files, options = DEFAULT_OPTIONS) {
    const { log } = options;

    const rootDir = { name: '', links: [] };
    const blocksToUpload = [];    
    for (let { name, content } of files) {
        const path = name.split('/');
        let dir = rootDir;
        for (let i = 0; i < path.length - 1; i++) {
            const dirName = path[i];
            let dirEntry = dir.links.find(({name}) => name === dirName);
            if (!dirEntry) {
                dirEntry = { name: dirName, links: [] };
                dir.links.push(dirEntry);
            }
            dir = dirEntry[1];
        }

        // TODO: Support files larger than one block
        const fileName = path[path.length - 1];
        const hash = computeHash(content);
        const cid = packCID({ hash, version: 1, codec: CODEC_RAW });
        const fileEntry = { name: fileName, cid, size: content.length };
        dir.links.push(fileEntry);

        blocksToUpload.push({ data: content, cid });
    }

    function addBlocksForDir(dir) {
        for (let entry of dir.links) {
            if (!entry.cid) {
                entry.cid = addBlocksForDir(entry);
            }
        }
        const pbNode = writePBNode({
            links: dir.links,
            data: Buffer.from([8, 1]) // TODO: Why this data needed to match?
        });
        const hash = computeHash(pbNode);
        const cid = packCID({ hash, version: 1, codec: CODEC_DAG_PB });
        blocksToUpload.push({ data: pbNode, cid });
        return cid;
    }        

    console.log('rootDir', rootDir);
    const rootCid = addBlocksForDir(rootDir);
    console.log('rootCid', cidToString(rootCid));

    for (let block of blocksToUpload) {
        console.log('block', cidToString(block.cid));
    }

    await uploadBlocks(blocksToUpload, options);

    return cidToString(rootCid);
}
