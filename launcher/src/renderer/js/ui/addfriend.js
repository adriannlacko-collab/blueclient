import { el } from './dom.js';
import { icons } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { host } from '../bridge.js';

/**
 * Add a friend (2026-09-21, Adrian: "make a 'add friends' button for the
 * friends card"). The game's own Add friend, on the launcher: a Minecraft
 * name, and the request goes the way the game's does — Mojang for the
 * uuid from this PC, then the site (src/main/friends.js, add). The answer
 * is said in the game's own words (screen/FriendsScreen.java): "Request
 * sent to X", "You and X are now friends", "No Minecraft player has that
 * name". A player who has never opened BlueClient cannot see a request,
 * so for them the panel offers what the game offers — the invitation on
 * the clipboard — and says so under the field.
 *
 * @param {{ onChanged?: () => void }} [options] called when the list may
 *   have changed (a friendship made on the spot, a request sent).
 */
export function openAddFriendModal({ onChanged } = {}) {
  let input;
  let line;
  let invite;
  let busy = false;

  const say = (text, why = false) => {
    line.textContent = text;
    line.classList.toggle('is-why', why);
    line.hidden = !text;
  };

  openModal({
    title: 'Add a friend',
    subtitle: 'Their Minecraft name. They answer in the game, under Friends.',
    className: 'modal--add-friend',
    build: (close) => {
      input = el('input', {
        class: 'input',
        placeholder: 'Minecraft name',
        maxlength: '16',
        autocomplete: 'off',
        spellcheck: 'false',
        onKeydown: (event) => { if (event.key === 'Enter') submit(close); }
      });
      line = el('p', { class: 'field__hint add-friend__line', hidden: true });
      invite = el('button', {
        class: 'btn btn--sm add-friend__invite',
        hidden: true,
        onClick: async () => {
          const result = await host.friends?.invite?.().catch(() => null);
          if (result?.ok) toast('Invitation copied — paste it to them', 'success');
          else toast('The invitation could not be copied.', 'error');
        }
      }, [
        el('span', { html: icons.copy, style: { display: 'contents' } }),
        el('span', { text: 'Copy an invitation' })
      ]);
      return [
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Name' }),
          input,
          line,
          invite
        ])
      ];
    },
    actions: (close) => [
      el('button', { class: 'btn btn--ghost', text: 'Cancel', onClick: () => close() }),
      el('button', { class: 'btn btn--primary btn--add add-friend__send', onClick: () => submit(close) }, [
        el('span', { html: icons.userPlus, style: { display: 'contents' } }),
        el('span', { text: 'Send request' })
      ])
    ]
  });

  async function submit(close) {
    if (busy) return;
    const name = input.value.trim();
    if (!name) {
      input.focus();
      say('Type a Minecraft name', true);
      return;
    }
    busy = true;
    invite.hidden = true;
    say('Asking…');
    let reply = null;
    try {
      reply = await host.friends?.add?.(name);
    } catch {
      reply = null;
    } finally {
      busy = false;
    }
    if (!reply?.ok) {
      say(reply?.line || "Can't reach BlueClient right now", true);
      input.focus();
      return;
    }
    onChanged?.();
    if (reply.status === 'friends') {
      close();
      toast(`You and ${reply.name} are now friends`, 'success');
      return;
    }
    if (reply.status === 'already') {
      say(`You and ${reply.name} are already friends`);
      return;
    }
    if (!reply.known) {
      /* The request waits for them; nothing of theirs shows it until they
         have BlueClient — the game's screen offers an invitation here too. */
      say(`${reply.name} isn't on BlueClient yet. Your request waits for them — an invitation tells them where to get it.`);
      invite.hidden = false;
      return;
    }
    close();
    toast(`Request sent to ${reply.name}`, 'success');
  }
}
