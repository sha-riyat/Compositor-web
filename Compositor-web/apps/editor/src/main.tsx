import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { documentStore, uiStore } from '@compositor/model';
import { Editor } from '@compositor/ui';
import './styles.css';

/**
 * En développement seulement : les stores sont accessibles depuis la console et
 * depuis les tests d'interface. Rien de tout cela n'existe en production.
 */
if (import.meta.env.DEV) {
  Object.assign(window, { __compositor: { documentStore, uiStore } });
}

/**
 * Le premier rendu attend que les polices soient prêtes.
 *
 * Ce n'est pas du confort : les règles, les courbes et l'histogramme écrivent
 * via `ctx.font`, et un premier dessin parti avant le chargement resterait sur
 * la police de repli jusqu'au prochain redessin — des graduations mal
 * dimensionnées, sans message d'erreur. L'application a de toute façon une
 * phase de démarrage, donc l'attente est gratuite.
 */
const start = async (): Promise<void> => {
  try {
    await document.fonts.ready;
  } catch {
    // Une police manquante ne doit pas empêcher l'éditeur de s'ouvrir.
  }

  if (!crossOriginIsolated) {
    console.warn(
      "Contexte non isolé entre origines : SharedArrayBuffer est indisponible. " +
        'Vérifiez les en-têtes COOP/COEP.',
    );
  }

  const container = document.getElementById('root');
  if (container === null) throw new Error('#root introuvable');

  createRoot(container).render(
    <StrictMode>
      <Editor />
    </StrictMode>,
  );
};

void start();
