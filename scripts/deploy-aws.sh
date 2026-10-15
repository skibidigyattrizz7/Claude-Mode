#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:-fc26-game}"
DOMAIN_NAME="${2:-}"
HOSTED_ZONE_ID="${3:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI v2 is required: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
  exit 1
fi

if [[ -n "$DOMAIN_NAME" && -z "$HOSTED_ZONE_ID" ]] || [[ -z "$DOMAIN_NAME" && -n "$HOSTED_ZONE_ID" ]]; then
  echo "Pass both a custom domain and its Route 53 hosted zone ID, or neither." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARAMETERS=()
if [[ -n "$DOMAIN_NAME" ]]; then
  PARAMETERS+=(--parameter-overrides "DomainName=$DOMAIN_NAME" "HostedZoneId=$HOSTED_ZONE_ID")
fi

aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$REPO_ROOT/infra/aws-static-site.yml" \
  --no-fail-on-empty-changeset \
  "${PARAMETERS[@]}"

BUCKET_NAME="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)"

DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"

WEBSITE_URL="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" \
  --output text)"

aws s3 sync "$REPO_ROOT" "s3://$BUCKET_NAME" \
  --region "$AWS_REGION" \
  --delete \
  --cache-control "public,max-age=300" \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude ".openai/*" \
  --exclude "dist/*" \
  --exclude "docs/*" \
  --exclude "infra/*" \
  --exclude "scripts/*" \
  --exclude "scratchpad/*" \
  --exclude "supabase/*" \
  --exclude "*/tests/*" \
  --exclude "README.md"

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" >/dev/null

echo "Deployment started: $WEBSITE_URL"
echo "CloudFront can take several minutes to finish distributing the first version."
