# AWS deployment runbook (one-time setup)

Target architecture (MVP):

- **API** — AWS Elastic Beanstalk, *Node.js 22 on Amazon Linux 2023* platform (no Docker), single instance. Deployed by GitHub Actions (`.github/workflows/deploy-api.yml`) via OIDC — no long-lived AWS keys.
- **Web** — AWS Amplify Hosting, connected directly to the GitHub repo (Amplify builds and deploys itself on push; no GitHub Actions workflow needed for the web app).
- **Database** — Amazon RDS for PostgreSQL 16+.

The deploy bundle is produced by `scripts/build-eb-bundle.sh`: prebuilt `dist/` output for `packages/core` and `apps/api`, the workspace `package.json`s + `package-lock.json`, `vendor/nestjs-throttler` (the `file:` dependency), `db/migrations/` + `scripts/migrate.mjs`, `Procfile`, and `.platform/` hooks. The EB instance only runs `npm install --omit=dev` — nothing is compiled on the instance. Migrations run automatically in a predeploy hook (`.platform/hooks/predeploy/01_run_migrations.sh`).

All commands below assume the AWS CLI is configured with an admin-ish profile and a chosen region (example: `eu-central-1`). Replace `<ACCOUNT_ID>` throughout.

---

## 1. RDS PostgreSQL

1. Create a PostgreSQL **16 or newer** instance (`db.t4g.micro` is fine for MVP), in the same VPC/region you'll use for Elastic Beanstalk. Note the master username/password and set an initial database name, e.g. `stamp_platform`.
   ```bash
   aws rds create-db-instance \
     --db-instance-identifier stamp-platform-db \
     --engine postgres --engine-version 16.6 \
     --db-instance-class db.t4g.micro \
     --allocated-storage 20 \
     --db-name stamp_platform \
     --master-username stampadmin --master-user-password '<CHOOSE-A-PASSWORD>' \
     --no-publicly-accessible
   ```
2. **Security group**: after the EB environment exists (step 2), add an inbound rule on the RDS security group allowing PostgreSQL (TCP 5432) **from the EB environment's instance security group** (it's named like `awseb-e-…-stack-AWSEBSecurityGroup-…`). Do not open 5432 to the world.
3. The connection string for EB (step 2.4):
   `postgres://stampadmin:<PASSWORD>@<rds-endpoint>:5432/stamp_platform`
   (add `?ssl=require` if you enforce TLS on the RDS parameter group; the `postgres` driver understands it).

You do **not** create the schema by hand — the predeploy hook applies `db/migrations/*.sql` idempotently on every deploy.

## 2. Elastic Beanstalk application + environment

1. Create the application:
   ```bash
   aws elasticbeanstalk create-application --application-name stamp-platform
   ```
2. Find the current *Node.js 22 on AL2023* solution stack name:
   ```bash
   aws elasticbeanstalk list-available-solution-stacks \
     --query 'SolutionStacks[?contains(@, `Node.js 22`)]'
   ```
3. Create a **single-instance** environment (no load balancer — MVP):
   ```bash
   aws elasticbeanstalk create-environment \
     --application-name stamp-platform \
     --environment-name stamp-platform-api \
     --solution-stack-name "64bit Amazon Linux 2023 v6.x.x running Node.js 22" \
     --option-settings \
       Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=SingleInstance \
       Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=aws-elasticbeanstalk-ec2-role
   ```
   (Create the default `aws-elasticbeanstalk-ec2-role` instance profile first if the account has never used EB: console → EB → the wizard creates it, or follow the EB docs.)
4. Set the environment properties (EB console → environment → *Configuration → Updates, monitoring, and logging → Environment properties*, or `update-environment --option-settings Namespace=aws:elasticbeanstalk:application:environment,...`):

   | Variable | Required | Value |
   |---|---|---|
   | `DATABASE_URL` | yes | RDS connection string from step 1.3 |
   | `QR_SIGNING_SECRET` | yes | long random string (`openssl rand -hex 32`) |
   | `JWT_SECRET` | yes | long random string (`openssl rand -hex 32`) |
   | `PUBLIC_BASE_URL` | yes | the public URL of this API, e.g. `http://stamp-platform-api.<region>.elasticbeanstalk.com` (update if you later add a custom domain/HTTPS) |
   | `GOOGLE_WALLET_ISSUER_ID` | optional | Google Wallet issuer id |
   | `GOOGLE_APPLICATION_CREDENTIALS` | optional | path on the instance to the service-account JSON |
   | `APPLE_TEAM_ID` | optional | Apple developer team id |
   | `APPLE_PASS_TYPE_ID` | optional | e.g. `pass.com.example.stamp` |
   | `APPLE_CERT_PATH` / `APPLE_CERT_PASSWORD` / `APPLE_WWDR_PATH` | optional | pass-signing cert paths/password |

   `PORT` is provided by the platform (8080) — do not set it. The wallet variables are **optional until credentials exist**: without them the wallet endpoints return **503 by design**; everything else works.
5. EB serves the app via nginx on port 80, proxying to the Node process on `PORT=8080`. The `Procfile` (`web: node apps/api/dist/main.js`) is the start command; no `npm start` is involved.

## 3. S3 bucket for deploy bundles

```bash
aws s3 mb s3://stamp-platform-deploys-<ACCOUNT_ID> --region <REGION>
```

Any private bucket in the same region works; the workflow uploads to `s3://$EB_S3_BUCKET/stamp-platform/eb-bundle-<sha>.zip`.

## 4. IAM: GitHub OIDC provider + deploy role

1. Create the OIDC identity provider (once per AWS account):
   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com
   ```
2. Create the deploy role with this **trust policy** (`trust.json`). The deploy job runs in the GitHub environment `production`, so the subject claim is pinned to it:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:matang-dave/stamping-platfrom:environment:production"
           }
         }
       }
     ]
   }
   ```
   ```bash
   aws iam create-role --role-name stamp-platform-github-deploy \
     --assume-role-policy-document file://trust.json
   ```
3. Attach a **least-privilege permissions policy** (`permissions.json`). EB's `update-environment` drives a CloudFormation stack update under the caller's credentials, so the CFN/autoscaling statements are required, not optional:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "UploadBundle",
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": "arn:aws:s3:::stamp-platform-deploys-<ACCOUNT_ID>/*"
       },
       {
         "Sid": "EbDeploy",
         "Effect": "Allow",
         "Action": [
           "elasticbeanstalk:CreateApplicationVersion",
           "elasticbeanstalk:DescribeApplicationVersions",
           "elasticbeanstalk:UpdateEnvironment",
           "elasticbeanstalk:DescribeEnvironments",
           "elasticbeanstalk:DescribeEvents",
           "elasticbeanstalk:DescribeEnvironmentHealth"
         ],
         "Resource": "*"
       },
       {
         "Sid": "EbInternalBuckets",
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:GetBucketLocation"],
         "Resource": [
           "arn:aws:s3:::elasticbeanstalk-*",
           "arn:aws:s3:::elasticbeanstalk-*/*"
         ]
       },
       {
         "Sid": "EbCloudFormation",
         "Effect": "Allow",
         "Action": [
           "cloudformation:GetTemplate",
           "cloudformation:DescribeStacks",
           "cloudformation:DescribeStackEvents",
           "cloudformation:DescribeStackResource",
           "cloudformation:DescribeStackResources",
           "cloudformation:UpdateStack"
         ],
         "Resource": "arn:aws:cloudformation:*:<ACCOUNT_ID>:stack/awseb-*"
       },
       {
         "Sid": "EbAutoScaling",
         "Effect": "Allow",
         "Action": [
           "autoscaling:DescribeAutoScalingGroups",
           "autoscaling:DescribeScalingActivities",
           "autoscaling:ResumeProcesses",
           "autoscaling:SuspendProcesses",
           "ec2:DescribeInstances",
           "ec2:DescribeInstanceStatus"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
   ```bash
   aws iam put-role-policy --role-name stamp-platform-github-deploy \
     --policy-name eb-deploy --policy-document file://permissions.json
   ```
   If a deploy fails with an `AccessDenied` naming an action not listed above, either add that action or (pragmatic fallback for MVP) attach the AWS managed policy `AdministratorAccess-AWSElasticBeanstalk` instead of the inline policy.

## 5. GitHub repository variables

Repo → *Settings → Secrets and variables → Actions → Variables* (these are non-secret names, so variables — not secrets — are fine):

| Variable | Value | Default in workflow |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/stamp-platform-github-deploy` | — (required) |
| `AWS_REGION` | e.g. `eu-central-1` | — (required) |
| `EB_S3_BUCKET` | `stamp-platform-deploys-<ACCOUNT_ID>` | — (required) |
| `EB_APP_NAME` | Elastic Beanstalk application name | `stamp-platform` |
| `EB_ENV_NAME` | Elastic Beanstalk environment name | `stamp-platform-api` |

Also create the GitHub **environment** `production` (repo → *Settings → Environments → New environment*) — the deploy job runs in it and the IAM trust policy pins the OIDC subject to it. Add required reviewers there if you want manual approval before deploys.

The workflow triggers on pushes to `main` that touch API/core/db/vendor/deploy files, and manually via *Actions → Deploy API (Elastic Beanstalk) → Run workflow*.

## 6. Amplify Hosting for the web app

Amplify deploys itself through its GitHub connection — **no GitHub Actions workflow exists or is needed for the web app.**

1. Amplify console → *Create new app → GitHub* → authorize and pick `matang-dave/stamping-platfrom`, branch `main`.
2. When asked about the app structure, mark it a **monorepo** and set the app root to **`apps/web`** (this sets `AMPLIFY_MONOREPO_APP_ROOT=apps/web`). The repo-root `amplify.yml` contains the matching `applications:` block (npm ci at the repo root, `@stamp/core` built before `next build`, artifacts `baseDirectory: .next`). Amplify should auto-detect Next.js SSR (WEB_COMPUTE).
3. Environment variables (Amplify console → app → *Hosting → Environment variables*):
   - `NEXT_PUBLIC_API_URL` = the public API URL from step 2 (the EB environment CNAME, e.g. `http://stamp-platform-api.<region>.elasticbeanstalk.com`). It is inlined at build time — change it and you must redeploy the branch.
4. Save; Amplify builds and hosts `apps/web`, and rebuilds automatically on every push to `main`.

Note: browsers block `http://` API calls from an `https://` Amplify page (mixed content). For real usage put HTTPS in front of the EB environment (ACM cert + load-balanced env, or CloudFront in front of the single instance) and set `NEXT_PUBLIC_API_URL`/`PUBLIC_BASE_URL` to the HTTPS URL.

## 7. First deploy + smoke checklist

1. Push to `main` (or run the *Deploy API* workflow manually) and wait for the green "deploy healthy" step.
2. Confirm migrations ran: EB console → environment → *Logs → Request last 100 lines* — `eb-hooks.log` should show `[migrate] applying db/migrations` (and `applied 0001_init.sql` etc. on first run).
3. `curl https://<api-url>/c/anything` → `{"message":"unknown_cafe","error":"Not Found","statusCode":404}` proves HTTP + DB connectivity end-to-end.
4. **Create a tenant** against RDS (needs devDeps, so run from a dev machine that can reach RDS — e.g. temporarily allow your IP in the RDS security group, or run it from an EC2 host in the VPC):
   ```bash
   DATABASE_URL='postgres://…rds…' npx tsx scripts/create-tenant.ts "Café Kranz" cafe-kranz
   ```
   Note the printed enrollment URL and owner PIN.
5. **Enroll page loads**: open `https://<amplify-url>/c/cafe-kranz` — the enrollment page renders and hitting *join* creates a pass (API call succeeds).
6. **Stamper login**: open `https://<amplify-url>/stamper`, log in with the cafe slug + owner PIN, and confirm a stamp can be recorded (scan or paste a QR payload from the pass page).
7. Wallet endpoints (`google-wallet` / Apple `.pkpass`) return **503 until the wallet credentials are provisioned — that is by design**, not a deployment failure.

## Known limitations (MVP)

- **Single-instance migrations**: the predeploy hook runs on *every* instance. With one instance that's safe and idempotent; if you scale out, concurrent hooks could race (a losing instance fails its deploy — data isn't corrupted, but the deploy is). Before scaling beyond one instance, move `node scripts/migrate.mjs` to a one-off step (leader-elected instance, a CI step with network access to RDS, or a manual run) and drop the hook.
- **HTTP only out of the box**: the single-instance EB CNAME is plain HTTP; see the mixed-content note in step 6.
- `scripts/migrate.mjs` is the production migration runner (plain Node, works after `npm install --omit=dev`); `scripts/migrate.ts` + tsx remains the dev-time entry (`npm run db:migrate`). Keep the two in sync when the migration logic changes.
