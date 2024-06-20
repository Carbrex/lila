import {
  ChatOpts,
  Line,
  Tab,
  ViewModel,
  Redraw,
  Permissions,
  ModerationCtrl,
  ChatData,
  NoteCtrl,
  ChatPalantir,
} from './interfaces';
import { PresetCtrl, presetCtrl } from './preset';
import { noteCtrl } from './note';
import { moderationCtrl } from './moderation';
import { prop } from 'common';

export default class ChatCtrl {
  data: ChatData;
  private maxLines = 200;
  private maxLinesDrop = 50; // how many lines to drop at once
  private subs: [string, PubsubCallback][];

  allTabs: Tab[] = ['discussion'];
  palantir: ChatPalantir;
  tabStorage = site.storage.make('chat.tab');
  storedTab = this.tabStorage.get();
  moderation: ModerationCtrl | undefined;
  note: NoteCtrl | undefined;
  preset: PresetCtrl;
  trans: Trans;
  vm: ViewModel;

  constructor(
    readonly opts: ChatOpts,
    readonly redraw: Redraw,
  ) {
    this.data = opts.data;
    if (opts.noteId) this.allTabs.push('note');
    if (opts.plugin) this.allTabs.push(opts.plugin.tab.key);
    this.palantir = {
      instance: undefined,
      loaded: false,
      enabled: prop(!!this.data.palantir),
    };
    this.trans = site.trans(this.opts.i18n);
    const noChat = site.storage.get('nochat');
    this.vm = {
      tab: this.allTabs.find(tab => tab === this.storedTab) || this.allTabs[0],
      enabled: opts.alwaysEnabled || !noChat,
      placeholderKey: 'talkInChat',
      loading: false,
      autofocus: false,
      timeout: opts.timeout,
      writeable: opts.writeable,
      domVersion: 1, // increment to force redraw
    };

    this.note = opts.noteId
      ? noteCtrl({
          id: opts.noteId,
          text: opts.noteText,
          trans: this.trans,
          redraw: this.redraw,
        })
      : undefined;

    this.preset = presetCtrl({
      initialGroup: opts.preset,
      post: this.post,
      redraw: this.redraw,
    });

    /* If discussion is disabled, and we have another chat tab,
     * then select that tab over discussion */
    if (this.allTabs.length > 1 && this.vm.tab === 'discussion' && noChat) this.vm.tab = this.allTabs[1];
    this.instanciateModeration();

    this.subs = [
      ['socket.in.message', this.onMessage],
      ['socket.in.chat_timeout', this.onTimeout],
      ['socket.in.chat_reinstate', this.onReinstate],
      ['chat.writeable', this.onWriteable],
      ['chat.permissions', this.onPermissions],
      ['palantir.toggle', this.palantir.enabled],
    ];

    this.subs.forEach(([eventName, callback]) => site.pubsub.on(eventName, callback));

    this.emitEnabled();
  }

  get plugin() {
    return this.opts.plugin;
  }

  post = (text: string): boolean => {
    text = text.trim();
    if (!text) return false;
    if (text.startsWith('<<<<')) return false;
    if (text == 'You too!' && !this.data.lines.some(l => l.u != this.data.userId)) return false;
    if (text.length > 140) {
      alert('Max length: 140 chars. ' + text.length + ' chars used.');
      return false;
    }

    if (site.analysis?.study?.relay&&!site.analysis.study.relay.tourShow()) {
      // let roundId = 'static-round-id';
      // let roundId = site.analysis.study.relay.currentRound().id;
      // let roundSlug = site.analysis.study.relay.currentRound().slug;
      // let gameId = 'static-game-id';
      let chapterId = site.analysis.study.currentChapter().id;
      let ply = site.analysis.study.currentNode().ply;
      // roundId = site.analysis.study.roundId();
      // gameId = site.analysis.study.gameId();
      // moveNo = site.analysis.study.moveNo();
      console.log('site-study', site.analysis.study);
      console.log('site-relay-tourShow', site.analysis.study.relay);
      console.log('site-relay-tourShow', site.analysis.study.relay.tourShow);
      console.log('site-round', site.analysis.study.relay.currentRound().id);
      console.log('site-round', site.analysis.study.relay.currentRound().slug);
      console.log('site-pos', site.analysis.study.position());
      console.log('site-game', site.analysis.study.currentChapter().id);
      console.log('site-shr-node', site.analysis.study.currentNode());
      console.log('site-shr-node', site.analysis.study.currentNode().ply);
      text = '<<<<' + chapterId + '|' + ply + '>>>> ' + text;
    }

    console.log('chat post', text);
    site.pubsub.emit('socket.send', 'talk', text);
    return true;
  };

  onTimeout = (userId: string) => {
    let change = false;
    this.data.lines.forEach(l => {
      if (l.u && l.u.toLowerCase() == userId) {
        l.d = true;
        change = true;
      }
    });
    if (userId == this.data.userId) this.vm.timeout = change = true;
    if (change) {
      this.vm.domVersion++;
      this.redraw();
    }
  };

  onReinstate = (userId: string) => {
    if (userId == this.data.userId) {
      this.vm.timeout = false;
      this.redraw();
    }
  };

  onMessage = (line: Line) => {
    this.data.lines.push(line);
    const nb = this.data.lines.length;
    console.log('chat message', line);
    console.log('chat lines', nb);
    console.log(this.data);
    if (nb > this.maxLines) {
      this.data.lines.splice(0, nb - this.maxLines + this.maxLinesDrop);
      this.vm.domVersion++;
    }
    this.redraw();
  };

  onWriteable = (v: boolean) => {
    this.vm.writeable = v;
    this.redraw();
  };

  onPermissions = (obj: Permissions) => {
    let p: keyof Permissions;
    for (p in obj) this.opts.permissions[p] = obj[p];
    this.instanciateModeration();
    this.redraw();
  };

  private instanciateModeration = () => {
    if (this.opts.permissions.timeout || this.opts.permissions.broadcast || this.opts.permissions.local) {
      this.moderation = moderationCtrl({
        reasons: this.opts.timeoutReasons || [{ key: 'other', name: 'Inappropriate behavior' }],
        permissions: this.opts.permissions,
        resourceId: this.data.resourceId,
        redraw: this.redraw,
      });
      site.asset.loadCssPath('chat.mod');
    }
  };

  destroy = () => {
    this.subs.forEach(([eventName, callback]) => site.pubsub.off(eventName, callback));
  };

  emitEnabled = () => site.pubsub.emit('chat.enabled', this.vm.enabled);

  setTab = (t: Tab) => {
    this.vm.tab = t;
    this.vm.autofocus = true;
    this.tabStorage.set(t);
    this.redraw();
  };

  setEnabled = (v: boolean) => {
    this.vm.enabled = v;
    this.emitEnabled();
    if (!v) site.storage.set('nochat', '1');
    else site.storage.remove('nochat');
    this.redraw();
  };
}
