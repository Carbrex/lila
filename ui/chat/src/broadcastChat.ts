// import { BroadcastChatHandler } from './interfaces';

// export function broadcastChatHandler(): BroadcastChatHandler {
//   const encode = (text: string): string => {
//     if (site.analysis?.study?.relay && !site.analysis.study.relay.tourShow()) {
//       let chapterId = site.analysis.study.currentChapter().id;
//       let ply = site.analysis.study.currentNode().ply;
//       // '\ue666' was arbitrarily chosen from the unicode private use area to separate the text from the chapterId and ply
//       text = text + '\ue666' + chapterId + '\ue666' + ply;
//     }
//     return text;
//   };
//   const getClearedText = (msg: string): string => {
//     if (msg.includes('\ue666') && site.analysis?.study?.relay) {
//       return msg.split('\ue666')[0];
//     }
//     return msg;
//   };
//   const jumpToMove = (msg: string): void => {
//     if (msg.includes('\ue666') && site.analysis?.study?.relay) {
//       let segs = msg.split('\ue666');
//       if (segs.length == 3) {
//         const [text, chapterId, ply] = segs;
//         console.log(text, chapterId, ply);
//         site.analysis.study.setChapter(chapterId);
//         site.analysis.jumpToMain(parseInt(ply));
//       }
//     }
//   };
//   return {
//     encode,
//     getClearedText,
//     jumpToMove,
//   };
// }
