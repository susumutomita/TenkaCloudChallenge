# mls-overfitting-regularization · MLS-C01 · difficulty 3 · $0

## Story

Kato-san's deep learning model (3-layer MLP, 4.3M parameters) achieves 99.1%
training accuracy but only 72.3% validation accuracy after 100 epochs. The
divergence between train and validation loss starts at epoch ~30 and widens
continuously. CTO Sasaki-san asks the new SRE to diagnose the problem and
name the correct family of remedies.

## What gets deployed

- **SSM Parameter** `/{NamePrefix}/briefing` — full training log with
  loss/accuracy at checkpoints 10/20/30/40/50/60/80/100, model architecture
  spec (layer sizes, optimizer, learning rate), and four candidate remedy
  families with precise definitions.
- **IAM Role** `ParticipantViewerRole` — SSM read + CloudShell only.

No EC2, no SageMaker, no Lambda invocation. Cost: $0.

## Solution (operator notes)

Train accuracy >> validation accuracy with validation loss increasing while
training loss decreases is the textbook **high-variance / overfitting** pattern.
The standard remedy family is **regularization**: L1, L2 (weight decay), Dropout,
or early stopping — all techniques that constrain model complexity.

- Adding more layers increases model capacity and worsens overfitting.
- Increasing the learning rate affects convergence speed, not generalization.
- More labeled data helps but is a data-collection strategy, not a regularization.

**Exact flag:** `TC{regularization}`

CLI one-liner to verify the briefing is deployed:

```bash
aws ssm get-parameter \
  --name "/${NAME_PREFIX}/briefing" \
  --query Parameter.Value \
  --output text
```

## Scoring

| Event          | Points |
|----------------|--------|
| Correct flag   | +200   |
| Wrong attempt  | −20    |

Hints: hint-1 (−20 pt) nudges toward identifying it as a variance problem;
hint-2 (−40 pt) reveals the answer.

## Learning goals

- Diagnose overfitting (high variance) from train/val divergence.
- Identify the regularization family (L1/L2/Dropout/early stopping) as the fix.
- Distinguish high-variance remedies from high-bias remedies for MLS-C01.
