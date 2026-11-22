'use strict';

function memoryStorage() {
  let game = null;
  const images = new Map();
  return {
    game: {
      async read() { return game; },
      async update(change) {
        const { next, result } = change(game);
        if (next) game = next;
        return result;
      }
    },
    photos: {
      async put(id, bytes) { images.set(id, bytes); },
      async get(id) { return images.get(id); },
      async remove(id) { images.delete(id); }
    }
  };
}

function cloudStorage(projectId, databaseId, bucketName) {
  const { Firestore } = require('@google-cloud/firestore');
  const { Storage } = require('@google-cloud/storage');
  const firestore = new Firestore({ projectId, databaseId });
  const document = firestore.collection('photoGuessGames').doc('current');
  const bucket = new Storage({ projectId }).bucket(bucketName);
  const photo = (id) => bucket.file('games/' + id + '.jpg');

  return {
    game: {
      async read() { return (await document.get()).data() || null; },
      async update(change) {
        return firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(document);
          const { next, result } = change(snapshot.data() || null);
          if (next) transaction.set(document, next);
          return result;
        });
      }
    },
    photos: {
      async put(id, bytes) {
        await photo(id).save(bytes, {
          resumable: false,
          contentType: 'image/jpeg',
          preconditionOpts: { ifGenerationMatch: 0 }
        });
      },
      async get(id) {
        try {
          const [bytes] = await photo(id).download();
          return bytes;
        } catch (error) {
          if (error.code !== 404) throw error;
        }
      },
      async remove(id) { await photo(id).delete({ ignoreNotFound: true }); }
    }
  };
}

module.exports = { memoryStorage, cloudStorage };
