import NodeID3 from 'node-id3';

export function writeTags(file: string, tags: NodeID3.Tags) {
  return NodeID3.update(tags, file);
}

export function writeCover(file: string, imageBuffer: Buffer) {
  return writeTags(file, {
    image: {
      mime: 'image/jpeg',
      type: {
        id: 3,
        name: 'front',
      },
      description: 'Cover',
      imageBuffer: imageBuffer,
    },
  });
}
