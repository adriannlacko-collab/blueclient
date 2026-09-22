import { el } from '../ui/dom.js';
import { icons } from '../icons.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { openMenu, menuItem, menuSeparator } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { avatarFor } from '../avatar.js';
import { paintAccountHead } from '../skin.js';
import {
  state, addAccount, signInWithMicrosoft, setActiveAccount, removeAccount,
  activeAccount, setRoute
} from '../state.js';

/**
 * Add-account chooser.
 *
 * Two ways in: a real Microsoft sign-in, and an offline account that only
 * names the player locally. Microsoft is listed first because it is the one
 * that reaches paid servers.
 *
 * The second row said "Add cracked account" until 2026-09-04. It is the word
 * the audience uses, and that is why it was there — but it is also the client
 * announcing, one screen away from a row of partner servers, that piracy is a
 * button here. "Offline account" is what the same players call it when they
 * are not being cheeky, and the line under it says plainly what it cannot do.
 */
export function openAccountModal() {
  const dismiss = openModal({
    title: 'Add account',
    subtitle: 'Accounts are stored on this device only.',
    build: () => [
      microsoftChoice(() => dismiss()),

      el('button', {
        class: 'choice',
        /* Not `dismiss()` first — the offline sheet takes this one's place on
           the scrim already under it. Closing first lifted the dim to nothing
           and brought it back, with both panes re-blurring across it; see the
           swap note in ui/modal.js. */
        onClick: () => openOfflineAccountModal()
      }, [
        el('span', { class: 'choice__icon', html: icons.user }),
        el('div', { class: 'stack' }, [
          el('span', { class: 'choice__title', text: 'Offline account' }),
          el('span', { class: 'choice__sub', text: 'Just a username. Servers that check ownership will turn it down' })
        ]),
        el('span', { class: 'spacer' }),
        el('span', { class: 'choice__caret', html: icons.chevronRight })
      ])
    ]
  });
}

/**
 * The Microsoft row, which does the signing in itself.
 *
 * Microsoft's window can sit open for as long as the player needs, so the row
 * shows that it is waiting rather than leaving a dead modal behind it. A
 * cancelled sign-in is silent: the player closed the window, they know why.
 */
function microsoftChoice(done) {
  const sub = el('span', {
    class: 'choice__sub',
    text: 'Sign in to play on servers that check ownership'
  });

  const row = el('button', {
    class: 'choice choice--confirm',
    onClick: async () => {
      if (row.disabled) return;
      row.disabled = true;
      sub.textContent = 'Waiting for the Microsoft window…';

      sub.classList.remove('choice__sub--why');

      const result = await signInWithMicrosoft();

      if (result.ok) {
        done();
        toast(`Signed in as ${result.account.username}`, 'success');
        return;
      }

      row.disabled = false;
      sub.textContent = 'Sign in to play on servers that check ownership';

      if (result.code === 'cancelled') return;

      /* There used to be a branch here for "no application id", which sent the
         player to a Settings field to paste an Azure id into. The launcher
         ships its own registration and falls back to it whenever the setting
         is empty, so that branch could never run — and the field it pointed at
         is gone (2026-09-04).

         The reason a sign-in failed is said on the row itself, not in a toast
         (2026-09-16): the Game Pass and child-account sentences are two lines
         each and say what to do next, and a toast had them gone in five seconds
         while the sheet the player has to act on stayed. The line holds until
         the next press. */
      sub.textContent = result.error;
      sub.classList.add('choice__sub--why');
    }
  }, [
    el('span', { class: 'choice__icon choice__icon--ms', html: icons.microsoft }),
    el('div', { class: 'stack' }, [
      el('span', { class: 'choice__title', text: 'Microsoft account' }),
      sub
    ]),
    el('span', { class: 'spacer' }),
    el('span', { class: 'choice__caret', html: icons.chevronRight })
  ]);

  return row;
}

/** The offline path: a username and nothing else. */
export function openOfflineAccountModal() {
  let input;
  let adding = false;

  openModal({
    title: 'Add offline account',
    subtitle: 'An offline account cannot join servers that check ownership.',
    build: (close) => {
      input = el('input', {
        class: 'input',
        placeholder: 'Minecraft username',
        maxlength: '16',
        autocomplete: 'off',
        spellcheck: 'false',
        onKeydown: (event) => { if (event.key === 'Enter') submit(close); }
      });

      return [
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Username' }),
          input,
          el('p', {
            class: 'field__hint',
            text: 'The skin is looked up from this name if it belongs to a real account.'
          })
        ])
      ];
    },
    actions: (close) => [
      el('button', { class: 'btn btn--ghost', text: 'Cancel', onClick: () => close() }),
      el('button', { class: 'btn btn--primary btn--add', text: 'Add account', onClick: () => submit(close) })
    ]
  });

  async function submit(close) {
    /* One account per press (2026-09-22): the account is on the list before
       the settings are written, so Enter pressed twice found the first press's
       account and said "already added" over the "Added" of the same name. */
    if (adding) return;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      toast('Enter a username', 'error');
      return;
    }
    if (state.accounts.some((a) => a.username.toLowerCase() === name.toLowerCase())) {
      toast('That account is already added', 'error');
      return;
    }
    adding = true;
    try {
      await addAccount(name);
    } finally {
      adding = false;
    }
    close();
    toast(`Added ${name}`, 'success');
  }
}

/** Account switcher hung off the titlebar chip. */
/** The player's own head, round, with the generated face until it arrives. */
function accountFace(account) {
  const face = el('span', {
    class: 'menu__account-face',
    style: {
      backgroundImage: `url("${avatarFor(account.username)}")`,
      backgroundSize: 'cover'
    }
  });
  paintAccountHead(face, account.username);
  return face;
}

export function openAccountMenu(anchor) {
  openMenu(anchor, (close) => {
    const rows = state.accounts.map((account) => {
      const isActive = account.id === state.activeAccountId;
      return el('button', {
        class: `menu__account${isActive ? ' is-active' : ''}`,
        role: 'menuitem',
        onClick: () => { setActiveAccount(account.id); close(); }
      }, [
        accountFace(account),
        el('span', { class: 'stack truncate' }, [
          el('span', { class: 'menu__account-name truncate', text: account.username }),
          // The account's own kind, not its selected state — the dot says which
          // one is in use.
          el('span', {
            class: 'menu__account-meta',
            text: account.type === 'microsoft' ? 'Microsoft' : 'Offline'
          })
        ]),
        isActive && el('span', { class: 'menu__account-dot' })
      ]);
    });

    const current = activeAccount();

    return [
      ...(rows.length ? rows : [el('div', { class: 'menu__label', text: 'No accounts' })]),
      menuSeparator(),
      menuItem({
        label: 'Add account',
        icon: icons.userPlus,
        onSelect: () => { close(); openAccountModal(); }
      }),
      // The Accounts page — every account with its own Set active and Remove
      // — is a hidden route, and this is its one door (2026-09-21; the row
      // had gone missing, so the only way to remove an account was to make
      // it the active one and sign out of it. Adrian: "make it so you can
      // actually remove accounts youve added").
      rows.length > 0 && menuItem({
        label: 'Manage accounts',
        icon: icons.users,
        onSelect: () => { close(); setRoute('accounts'); }
      }),
      current && menuItem({
        label: 'Sign out',
        icon: icons.logOut,
        danger: true,
        onSelect: async () => {
          close();
          const ok = await confirmModal({
            title: `Sign out of ${current.username}?`,
            message: 'The account is removed from this device. You can add it again at any time.',
            confirmLabel: 'Sign out'
          });
          if (!ok) return;
          await removeAccount(current.id);
          toast('Signed out', 'info');
        }
      })
    ];
  }, { width: 272 });
}
