import NodeID3 from 'node-id3';

export function readTag(file: string) {
  return NodeID3.read(file);
}
