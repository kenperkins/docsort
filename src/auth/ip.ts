import { BlockList, isIP } from 'net';

export function parseTrustedProxies(cidrs: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address, prefixText] = cidr.split('/');
    const family = isIP(address);
    const prefix = prefixText === undefined ? (family === 6 ? 128 : 32) : Number(prefixText);
    const maxPrefix = family === 6 ? 128 : 32;
    if (family === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`invalid CIDR "${cidr}"`);
    }
    list.addSubnet(address, prefix, family === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

export function isTrustedAddress(list: BlockList, address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  // Dual-stack sockets report IPv4 peers as ::ffff:a.b.c.d.
  const unmapped = address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const family = isIP(unmapped);
  if (family === 0) {
    return false;
  }
  return list.check(unmapped, family === 6 ? 'ipv6' : 'ipv4');
}
