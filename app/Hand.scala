package lila

import model._
import memo._
import db.{ GameRepo }
import chess._
import Pos.posAt
import scalaz.effects._

final class Hand(
    gameRepo: GameRepo,
    messenger: Messenger,
    takeback: Takeback,
    ai: () ⇒ Ai,
    finisher: Finisher,
    moretimeSeconds: Int) {

  type IOValidEvents = IO[Valid[List[Event]]]

  def play(
    povRef: PovRef,
    origString: String,
    destString: String,
    promString: Option[String] = None,
    blur: Boolean = false): IOValidEvents = fromPov(povRef) {
    case Pov(g1, color) ⇒ (for {
      g2 ← (g1.playable).fold(success(g1), failure("Game not playable" wrapNel))
      orig ← posAt(origString) toValid "Wrong orig " + origString
      dest ← posAt(destString) toValid "Wrong dest " + destString
      promotion ← Role promotable promString toValid "Wrong promotion"
      newChessGameAndMove ← g2.toChess(orig, dest, promotion)
      (newChessGame, move) = newChessGameAndMove
    } yield g2.update(newChessGame, move, blur)).fold(
      e ⇒ io(failure(e)),
      progress ⇒ for {
        events ← if (progress.game.finished) for {
          _ ← gameRepo save progress
          finishEvents ← finisher.moveFinish(progress.game, color)
        } yield progress.events ::: finishEvents
        else if (progress.game.player.isAi && progress.game.playable) for {
          aiResult ← ai()(progress.game) map (_.err)
          (newChessGame, move) = aiResult
          progress2 = progress flatMap { _.update(newChessGame, move) }
          _ ← gameRepo save progress2
          finishEvents ← finisher.moveFinish(progress2.game, !color)
        } yield progress2.events ::: finishEvents
        else for {
          _ ← gameRepo save progress
        } yield progress.events
      } yield success(events)
    )
  }

  def abort(fullId: String): IOValidEvents = attempt(fullId, finisher.abort)

  def resign(fullId: String): IOValidEvents = attempt(fullId, finisher.resign)

  def outoftime(ref: PovRef): IOValidEvents = attemptRef(ref, finisher outoftime _.game)

  def drawClaim(fullId: String): IOValidEvents = attempt(fullId, finisher.drawClaim)

  def drawAccept(fullId: String): IOValidEvents = attempt(fullId, finisher.drawAccept)

  def drawOffer(fullId: String): IOValidEvents = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (g1 playerCanOfferDraw color) {
        if (g1.player(!color).isOfferingDraw) finisher drawAccept pov
        else success {
          for {
            p1 ← messenger.systemMessages(g1, "Draw offer sent") map { es ⇒
              Progress(g1, ReloadTableEvent(!color) :: es)
            }
            p2 = p1 map { g ⇒ g.updatePlayer(color, _ offerDraw g.turns) }
            _ ← gameRepo save p2
          } yield p2.events
        }
      }
      else !!("invalid draw offer " + fullId)
  })

  def drawCancel(fullId: String): IO[Valid[List[Event]]] = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (pov.player.isOfferingDraw) success {
        for {
          p1 ← messenger.systemMessages(g1, "Draw offer canceled") map { es ⇒
            Progress(g1, ReloadTableEvent(!color) :: es)
          }
          p2 = p1 map { g ⇒ g.updatePlayer(color, _.removeDrawOffer) }
          _ ← gameRepo save p2
        } yield p2.events
      }
      else !!("no draw offer to cancel " + fullId)
  })

  def drawDecline(fullId: String): IO[Valid[List[Event]]] = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (g1.player(!color).isOfferingDraw) success {
        for {
          p1 ← messenger.systemMessages(g1, "Draw offer declined") map { es ⇒
            Progress(g1, ReloadTableEvent(!color) :: es)
          }
          p2 = p1 map { g ⇒ g.updatePlayer(!color, _.removeDrawOffer) }
          _ ← gameRepo save p2
        } yield p2.events
      }
      else !!("no draw offer to decline " + fullId)
  })

  def takebackAccept(fullId: String): IOValidEvents =
    attempt(fullId, pov ⇒
      if (pov.opponent.isProposingTakeback) takeback(pov.game)
      else !!("opponent is not proposing a takeback")
    )

  def takebackOffer(fullId: String): IOValidEvents = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (g1.playable && g1.bothPlayersHaveMoved) {
        if (g1.player(!color).isAi.pp) takeback double pov.game
        else if (g1.player(!color).isProposingTakeback) takeback(pov.game)
        else success {
          for {
            p1 ← messenger.systemMessages(g1, "Takeback proposition sent") map { es ⇒
              Progress(g1, ReloadTableEvent(!color) :: es)
            }
            p2 = p1 map { g ⇒ g.updatePlayer(color, _.proposeTakeback) }
            _ ← gameRepo save p2
          } yield p2.events
        }
      }
      else !!("invalid takeback proposition" + fullId)
  })

  def takebackCancel(fullId: String): IO[Valid[List[Event]]] = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (pov.player.isProposingTakeback) success {
        for {
          p1 ← messenger.systemMessages(g1, "Takeback proposition canceled") map { es ⇒
            Progress(g1, ReloadTableEvent(!color) :: es)
          }
          p2 = p1 map { g ⇒ g.updatePlayer(color, _.removeTakebackProposition) }
          _ ← gameRepo save p2
        } yield p2.events
      }
      else !!("no takeback proposition to cancel " + fullId)
  })

  def takebackDecline(fullId: String): IO[Valid[List[Event]]] = attempt(fullId, {
    case pov @ Pov(g1, color) ⇒
      if (g1.player(!color).isProposingTakeback) success {
        for {
          p1 ← messenger.systemMessages(g1, "Takeback proposition declined") map { es ⇒
            Progress(g1, ReloadTableEvent(!color) :: es)
          }
          p2 = p1 map { g ⇒ g.updatePlayer(!color, _.removeTakebackProposition) }
          _ ← gameRepo save p2
        } yield p2.events
      }
      else !!("no takeback proposition to decline " + fullId)
  })

  def moretime(ref: PovRef): IO[Valid[List[Event]]] = attemptRef(ref, pov ⇒
    pov.game.clock filter (_ ⇒ pov.game.playable) map { clock ⇒
      val color = !pov.color
      val newClock = clock.giveTime(color, moretimeSeconds)
      val progress = pov.game withClock newClock
      for {
        events ← messenger.systemMessage(
          progress.game, "%s + %d seconds".format(color, moretimeSeconds)
        )
        progress2 = progress ++ (ClockEvent(newClock) :: events)
        _ ← gameRepo save progress2
      } yield progress2.events
    } toValid "cannot add moretime"
  )

  private def attempt[A](
    fullId: String,
    action: Pov ⇒ Valid[IO[A]]): IO[Valid[A]] =
    fromPov(fullId) { pov ⇒ action(pov).sequence }

  private def attemptRef[A](
    ref: PovRef,
    action: Pov ⇒ Valid[IO[A]]): IO[Valid[A]] =
    fromPov(ref) { pov ⇒ action(pov).sequence }

  private def fromPov[A](ref: PovRef)(op: Pov ⇒ IO[Valid[A]]): IO[Valid[A]] =
    fromPov(gameRepo pov ref)(op)

  private def fromPov[A](fullId: String)(op: Pov ⇒ IO[Valid[A]]): IO[Valid[A]] =
    fromPov(gameRepo pov fullId)(op)

  private def fromPov[A](povIO: IO[Option[Pov]])(op: Pov ⇒ IO[Valid[A]]): IO[Valid[A]] =
    povIO flatMap { povOption ⇒
      povOption.fold(
        pov ⇒ op(pov),
        io { "No such game".failNel }
      )
    }
}
