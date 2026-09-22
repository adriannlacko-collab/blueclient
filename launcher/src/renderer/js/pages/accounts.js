import { el, mount } from '../ui/dom.js';
import { icons } from '../icons.js';
import { confirmModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { avatarFor } from '../avatar.js';
import { openAccountModal } from './account.js';
import { state, setActiveAccount, removeAccount, setRoute } from '../state.js';

let list;

export function render() {
  list = el('div', { class: 'account-list' });
  paint();

  return el('div', { class: 'page' }, [
    el('div', { class: 'page__inner' }, [
      /* A hidden route reached from the account menu (2026-09-21): the way
         back is the way Worlds has one, a grey Back that only goes somewhere. */
      el('header', { class: 'page-actions' }, [
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onClick: () => setRoute('home') }, [
          el('span', { html: icons.chevronLeft, style: { display: 'contents' } }),
          el('span', { text: 'Back' })
        ])
      ]),
      /* Adding an account is the primary job of this page, so it leads. */
      el('button', { class: 'add-account', onClick: () => openAccountModal() }, [
        el('span', { class: 'add-account__plus', html: icons.plus }),
        el('div', { class: 'stack' }, [
          el('span', { class: 'add-account__title', text: 'Add an account' }),
          el('span', { class: 'add-account__sub', text: 'Microsoft account, or just a name' })
        ]),
        el('span', { class: 'spacer' }),
        el('span', { class: 'add-account__caret', html: icons.chevronRight })
      ]),

      el('h2', { class: 'section-title', text: 'Your accounts' }),
      list
    ])
  ]);
}

function paint() {
  if (!state.accounts.length) {
    list.className = '';
    mount(list, el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', html: icons.users }),
      el('p', { class: 'empty__title', text: 'No accounts yet' }),
      el('p', { class: 'empty__text', text: 'Add an account to launch the game.' })
    ]));
    return;
  }

  list.className = 'account-list';
  mount(list, ...state.accounts.map(row));
}

function row(account) {
  const isActive = account.id === state.activeAccountId;
  const microsoft = account.type === 'microsoft';

  return el('article', { class: `account-row${isActive ? ' is-active' : ''}` }, [
    el('div', { class: 'account-row__face-wrap' }, [
      el('img', { class: 'account-row__face', src: avatarFor(account.username), alt: '' }),
      isActive && el('span', { class: 'account-row__active', html: icons.check })
    ]),

    el('div', { class: 'stack truncate', style: { gap: '6px' } }, [
      el('div', { class: 'account-row__name-line' }, [
        el('span', { class: 'account-row__name truncate', text: account.username }),
        el('span', {
          class: 'account-row__glyph',
          html: microsoft ? icons.shield : icons.user,
          'aria-hidden': 'true'
        })
      ]),
      el('div', { class: 'account-row__meta' }, [
        el('span', {
          class: `account-tag account-tag--${microsoft ? 'ms' : 'offline'}`,
          text: microsoft ? 'MICROSOFT' : 'OFFLINE'
        }),
        el('span', { class: 'account-row__added', text: `Added ${dateOf(account.addedAt)}` })
      ])
    ]),

    el('span', { class: 'spacer' }),

    /* Set active, and remove. "Skins & Capes" and "Clear cache" sat here
       until 2026-09-03 doing neither: the first toasted that it was not built,
       the second claimed to have cleared a cache that does not exist. */
    el('div', { class: 'account-row__actions' }, [
      !isActive && el('button', {
        class: 'btn btn--primary',
        text: 'Set active',
        onClick: () => { setActiveAccount(account.id); paint(); }
      }),
      /* A word, not a glyph (2026-09-21): the trash icon alone was the one
         control on the page nobody found — Adrian: "make it so you can
         actually remove accounts youve added". Red, inside the card, the way
         the one button that deletes is everywhere. */
      el('button', {
        class: 'btn btn--danger',
        'aria-label': `Remove ${account.username}`,
        text: 'Remove',
        onClick: async () => {
          const ok = await confirmModal({
            title: `Remove ${account.username}?`,
            message: 'The account is removed from this device. You can add it again at any time.',
            confirmLabel: 'Remove account'
          });
          if (!ok) return;
          await removeAccount(account.id);
          paint();
          toast('Account removed', 'success');
        }
      })
    ])
  ]);
}

function dateOf(timestamp) {
  if (!timestamp) return 'unknown';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
