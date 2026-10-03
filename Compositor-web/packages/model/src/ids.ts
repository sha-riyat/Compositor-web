/**
 * Un identifiant neuf, sous la forme de `UUID.uuidString` dans l'original :
 * **en majuscules**. `crypto.randomUUID` les rend en minuscules, et un projet
 * enregistré puis rouvert revenait avec des identifiants en majuscules — le
 * même calque, mais plus le même texte.
 */
// Le modèle ne dépend pas du DOM : on type seulement ce qu'on en utilise,
// présent dans les navigateurs comme dans Node.
const { crypto } = globalThis as unknown as { crypto: { randomUUID(): string } };

export const newId = (): string => crypto.randomUUID().toUpperCase();
