// dsh-tool-graphic-chain: node half — deliberately empty.
//
// The whole feature is pure browser UI (see lib/client.js). This half exists
// only so the package can ride the host loader's entry list and carry its
// `dsh.client` bundle declaration.
export const name = "dsh-tool-graphic-chain";

export function apply() {}