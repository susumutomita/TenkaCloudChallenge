import {
  ACTION,
  AUDIENCE_KEY,
  OBSERVATIONS,
  PROVIDER_ARN,
  SUBJECT_KEY,
  TARGET_AUDIENCE,
  TARGET_SUBJECT,
} from "../app/engine.mjs";

export const REFERENCE_POLICY = Object.freeze({
  diagnosis: [...OBSERVATIONS],
  trustPolicy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: PROVIDER_ARN },
        Action: ACTION,
        Condition: {
          StringEquals: {
            [AUDIENCE_KEY]: TARGET_AUDIENCE,
            [SUBJECT_KEY]: TARGET_SUBJECT,
          },
        },
      },
    ],
  },
});
