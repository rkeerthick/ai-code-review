terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  backend "s3" {
    bucket         = "ai-code-review-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "ai-code-review"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ─── VPC ─────────────────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "acr-${var.environment}"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "production"  # Multi-NAT for prod HA
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# ─── EKS Cluster ─────────────────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "acr-${var.environment}"
  cluster_version = "1.31"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    api = {
      instance_types = ["m5.large"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3

      labels = { role = "api" }
    }

    workers = {
      instance_types = ["c5.xlarge"]  # Compute-optimized for AI workloads
      min_size       = 1
      max_size       = 15
      desired_size   = 2

      labels = { role = "worker" }
      taints = [{ key = "dedicated", value = "workers", effect = "NO_SCHEDULE" }]
    }
  }
}

# ─── RDS Aurora PostgreSQL ───────────────────────────────────────────
module "rds" {
  source  = "terraform-aws-modules/rds-aurora/aws"
  version = "~> 9.0"

  name            = "acr-${var.environment}"
  engine          = "aurora-postgresql"
  engine_version  = "16.2"
  master_username = "postgres"

  vpc_id  = module.vpc.vpc_id
  subnets = module.vpc.private_subnets

  instances = {
    1 = { instance_class = "db.r6g.large" }
    2 = { instance_class = "db.r6g.large", promotion_tier = 1 }  # Reader replica
  }

  storage_encrypted      = true
  deletion_protection    = var.environment == "production"
  skip_final_snapshot    = var.environment != "production"
  backup_retention_period = 7

  performance_insights_enabled = true

  tags = { Name = "acr-postgres-${var.environment}" }
}

# ─── ElastiCache Redis ───────────────────────────────────────────────
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "acr-redis-${var.environment}"
  description          = "Redis cluster for AI Code Review"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.r6g.large"
  num_cache_clusters   = var.environment == "production" ? 3 : 1

  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled           = var.environment == "production"

  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = var.redis_auth_token

  subnet_group_name = aws_elasticache_subnet_group.redis.name

  tags = { Name = "acr-redis-${var.environment}" }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "acr-redis-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

# ─── S3 Buckets ───────────────────────────────────────────────────────
resource "aws_s3_bucket" "uploads" {
  bucket = "acr-uploads-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# ─── Secrets Manager ─────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "app_secrets" {
  name                    = "acr/${var.environment}/app-secrets"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

# ─── CloudFront (CDN) ────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "ACR ${var.environment} CDN"
  price_class         = "PriceClass_100"  # US + Europe

  origin {
    domain_name = "api.aicodereview.io"
    origin_id   = "API"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
    }
  }

  default_cache_behavior {
    target_origin_id       = "API"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "X-Api-Key"]
      cookies { forward = "all" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_caller_identity" "current" {}
