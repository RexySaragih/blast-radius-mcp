export type ProtoField = {
  message: string;
  name: string;
  type: string;
};

export type ProtoRpc = {
  service: string;
  name: string;
};

export type ProtoModel = {
  messages: string[];
  fields: ProtoField[];
  rpcs: ProtoRpc[];
};

export function parseProtobuf(source: string): ProtoModel {
  const messages: string[] = [];
  const fields: ProtoField[] = [];
  const rpcs: ProtoRpc[] = [];
  let currentMessage: string | null = null;
  let currentService: string | null = null;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const messageMatch = line.match(/^message\s+(\w+)/);
    if (messageMatch) {
      currentMessage = messageMatch[1] ?? null;
      if (currentMessage) messages.push(currentMessage);
      continue;
    }
    const serviceMatch = line.match(/^service\s+(\w+)/);
    if (serviceMatch) {
      currentService = serviceMatch[1] ?? null;
      continue;
    }
    if (line === '}') {
      currentMessage = null;
      continue;
    }
    if (currentService) {
      const rpcMatch = line.match(/^rpc\s+(\w+)/);
      if (rpcMatch?.[1]) rpcs.push({ service: currentService, name: rpcMatch[1] });
    }
    if (currentMessage) {
      const fieldMatch = line.match(/^(\w+)\s+(\w+)\s*=\s*\d+/);
      if (fieldMatch?.[1] && fieldMatch[2]) {
        fields.push({ message: currentMessage, type: fieldMatch[1], name: fieldMatch[2] });
      }
    }
  }

  return { messages, fields, rpcs };
}
