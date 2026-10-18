// Amplia app.json amb les dades del projecte d'Expo, que arriben per variables d'entorn
// (així el repositori no queda lligat a cap compte concret).
//   EXPO_PROJECT_ID: identificador del projecte a expo.dev
//   EXPO_OWNER:      compte o organització d'Expo propietària (opcional)
module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PROJECT_ID;
  return {
    ...config,
    ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
