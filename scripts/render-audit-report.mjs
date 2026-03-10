#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function pretty(v){return JSON.stringify(v ?? null,null,2)}

const inPath = process.argv[2];
if(!inPath){
  console.error('Usage: node scripts/render-audit-report.mjs <run-json-path>');
  process.exit(1);
}

const absIn = path.resolve(inPath);
const data = JSON.parse(fs.readFileSync(absIn,'utf8'));
const templatePath = path.resolve('docs/templates/audit-report-template.md');
let tpl = fs.readFileSync(templatePath,'utf8');

const map = {
  '{{meta.timestamp}}': data.meta?.timestamp ?? '',
  '{{meta.resourceUrl}}': data.meta?.resourceUrl ?? '',
  '{{meta.facilitatorUrl}}': data.meta?.facilitatorUrl ?? '',
  '{{meta.durationMs.request1}}': String(data.meta?.durationMs?.request1 ?? ''),
  '{{meta.durationMs.request2}}': String(data.meta?.durationMs?.request2 ?? ''),
  '{{meta.durationMs.total}}': String(data.meta?.durationMs?.total ?? ''),

  '{{http.firstRequest.method}}': data.http?.firstRequest?.method ?? '',
  '{{http.firstRequest.url}}': data.http?.firstRequest?.url ?? '',
  '{{http.firstResponse.status}}': String(data.http?.firstResponse?.status ?? ''),
  '{{http.firstResponse.headers.paymentRequired}}': data.http?.firstResponse?.headers?.paymentRequired ?? '',
  '{{http.firstResponse.paymentRequiredDecoded.json}}': pretty(data.http?.firstResponse?.paymentRequiredDecoded),

  '{{http.secondRequest.method}}': data.http?.secondRequest?.method ?? '',
  '{{http.secondRequest.url}}': data.http?.secondRequest?.url ?? '',
  '{{http.secondResponse.status}}': String(data.http?.secondResponse?.status ?? ''),
  '{{http.secondRequest.headers.PAYMENT-SIGNATURE}}': data.http?.secondRequest?.headers?.['PAYMENT-SIGNATURE'] ?? '',

  '{{addresses.payer}}': data.addresses?.payer ?? '',
  '{{signing.signatureObject.json}}': pretty(data.signing?.signatureObject),
  '{{signing.paymentPayload.json}}': pretty(data.signing?.paymentPayload),
  '{{signing.signatureHex}}': data.signing?.signatureObject?.payload?.signature ?? '',

  '{{http.secondResponse.headers.paymentResponse}}': data.http?.secondResponse?.headers?.paymentResponse ?? '',
  '{{http.secondResponse.paymentResponseDecoded.json}}': pretty(data.http?.secondResponse?.paymentResponseDecoded),
  '{{settlement.txHash}}': data.settlement?.txHash ?? '',
  '{{http.secondResponse.paymentResponseDecoded.network}}': data.http?.secondResponse?.paymentResponseDecoded?.network ?? '',
  '{{http.secondResponse.paymentResponseDecoded.payer}}': data.http?.secondResponse?.paymentResponseDecoded?.payer ?? '',

  '{{settlement.txReceipt.status}}': String(data.settlement?.txReceipt?.status ?? ''),
  '{{settlement.txReceipt.blockNumber}}': String(data.settlement?.txReceipt?.blockNumber ?? ''),
  '{{settlement.txReceipt.from}}': data.settlement?.txReceipt?.from ?? '',
  '{{settlement.txReceipt.to}}': data.settlement?.txReceipt?.to ?? '',
  '{{settlement.txReceipt.gasUsed}}': String(data.settlement?.txReceipt?.gasUsed ?? ''),
  '{{settlement.txReceipt.effectiveGasPrice}}': String(data.settlement?.txReceipt?.effectiveGasPrice ?? ''),
  '{{settlement.logsCount}}': String(data.settlement?.txReceipt?.logs?.length ?? 0),

  '{{balances.before.eth}}': String(data.balances?.before?.eth ?? ''),
  '{{balances.before.usdc}}': String(data.balances?.before?.usdc ?? ''),
  '{{balances.before.usdcRaw}}': String(data.balances?.before?.usdcRaw ?? ''),
  '{{balances.after.eth}}': String(data.balances?.after?.eth ?? ''),
  '{{balances.after.usdc}}': String(data.balances?.after?.usdc ?? ''),
  '{{balances.after.usdcRaw}}': String(data.balances?.after?.usdcRaw ?? ''),
};

for(const [k,v] of Object.entries(map)) tpl = tpl.split(k).join(v);

const outPath = absIn.replace(/\.json$/i,'.audit.md');
fs.writeFileSync(outPath, tpl);
console.log(outPath);
