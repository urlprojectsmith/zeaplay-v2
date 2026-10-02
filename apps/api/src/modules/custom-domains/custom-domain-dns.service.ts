import { Injectable } from '@nestjs/common';
import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import { validateEnvironment } from '@zea-play/config';
import {
  extractVerificationToken,
  hashVerificationToken,
  timingSafeHashEqual,
} from './custom-domain-secrets';
import { txtRecordName } from './custom-domain-normalization';

export interface DnsVerificationResult {
  ok: boolean;
  code?: string;
  message?: string;
  records?: string[];
}

@Injectable()
export class CustomDomainDnsService {
  private readonly env = validateEnvironment(process.env);

  async verifyTxt(
    normalizedHostname: string,
    expectedHash: string,
  ): Promise<DnsVerificationResult> {
    const recordName = txtRecordName(normalizedHostname);
    try {
      const answers = await resolveTxt(recordName);
      const values = answers.map((segments) => segments.join(''));
      for (const value of values) {
        const token = extractVerificationToken(value);
        if (token && timingSafeHashEqual(hashVerificationToken(token), expectedHash)) {
          return { ok: true, records: values };
        }
      }
      return {
        ok: false,
        code: 'TXT_VALUE_MISMATCH',
        message: 'TXT record was found but did not match.',
      };
    } catch {
      return { ok: false, code: 'TXT_NOT_FOUND', message: 'TXT record has not propagated yet.' };
    }
  }

  async inspectRouting(normalizedHostname: string) {
    const [a, aaaa, cname] = await Promise.all([
      resolve4(normalizedHostname).catch(() => [] as string[]),
      resolve6(normalizedHostname).catch(() => [] as string[]),
      resolveCname(normalizedHostname).catch(() => [] as string[]),
    ]);
    const publicIps = csv(this.env.CUSTOM_DOMAIN_PUBLIC_IPS);
    const approvedCnames = csv(this.env.CUSTOM_DOMAIN_APPROVED_CNAME_HOSTS).map((value) =>
      value.replace(/\.+$/, '').toLowerCase(),
    );
    const directMatch =
      publicIps.length > 0 && [...a, ...aaaa].some((ip) => publicIps.includes(ip));
    const cnameMatch =
      approvedCnames.length > 0 &&
      cname
        .map((value) => value.replace(/\.+$/, '').toLowerCase())
        .some((value) => approvedCnames.includes(value));
    return {
      a,
      aaaa,
      cname,
      directMatch,
      cnameMatch,
      proxiedProviderDecision:
        !directMatch && !cnameMatch && (a.length > 0 || aaaa.length > 0 || cname.length > 0)
          ? 'DO_NOT_FAIL_SOLELY_ON_PUBLIC_RESOLVER_IP'
          : 'NO_ROUTING_RECORDS_OBSERVED',
    };
  }
}

function csv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
