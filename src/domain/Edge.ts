import { sha256Hex } from './Symbol.js';

export type EdgeType = 'calls' | 'imports' | 'implements' | 'queries' | 'publishes';

export type Edge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
};

export function makeEdgeId(sourceId: string, type: EdgeType, targetId: string): string {
  return sha256Hex(`${sourceId}|${type}|${targetId}`);
}

export function createEdge(sourceId: string, type: EdgeType, targetId: string): Edge {
  return {
    id: makeEdgeId(sourceId, type, targetId),
    sourceId,
    targetId,
    type,
  };
}
