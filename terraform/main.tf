terraform {
  required_version = ">= 1.3.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0.0"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
  }
}

data "azurerm_client_config" "current" {}

# Generate unique suffix for resources
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# Resource Group
resource "azurerm_resource_group" "rg" {
  name     = "${var.resource_group_name_prefix}-${var.app_name}-${random_string.suffix.result}"
  location = var.location
}

# Azure SQL Server
resource "azurerm_mssql_server" "sql" {
  name                         = "sql-${var.app_name}-${random_string.suffix.result}"
  resource_group_name          = azurerm_resource_group.rg.name
  location                     = azurerm_resource_group.rg.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = var.sql_admin_password
}

# Azure SQL Database
resource "azurerm_mssql_database" "db" {
  name         = "db-${var.app_name}"
  server_id    = azurerm_mssql_server.sql.id
  collation    = "SQL_Latin1_General_CP1_CI_AS"
  license_type = "BasePrice"
  max_size_gb  = 2
  sku_name     = "Basic" # Economical tier for development/testing
}

# Firewall rule: Allow access to Azure services (IP 0.0.0.0)
resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.sql.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Key Vault
resource "azurerm_key_vault" "kv" {
  name                        = "kv-${var.app_name}-${random_string.suffix.result}"
  location                    = azurerm_resource_group.rg.location
  resource_group_name         = azurerm_resource_group.rg.name
  enabled_for_disk_encryption = true
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  soft_delete_retention_days  = 7
  purge_protection_enabled    = false

  sku_name = "standard"
}

# Access Policy for Terraform Deployer (so Terraform can write secrets)
resource "azurerm_key_vault_access_policy" "deployer_policy" {
  key_vault_id = azurerm_key_vault.kv.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = [
    "Get", "List", "Set", "Delete", "Purge", "Recover"
  ]
}

# Create SQL Connection String Secret
resource "azurerm_key_vault_secret" "db_conn" {
  name         = "DatabaseConnectionString"
  value        = "Server=tcp:${azurerm_mssql_server.sql.fully_qualified_domain_name},1433;Database=${azurerm_mssql_database.db.name};User ID=${var.sql_admin_username};Password=${var.sql_admin_password};Encrypt=true;Connection Timeout=30;"
  key_vault_id = azurerm_key_vault.kv.id

  # Ensure the deployer access policy is created before attempting to write secrets
  depends_on = [azurerm_key_vault_access_policy.deployer_policy]
}

# App Service Plan (Linux)
resource "azurerm_service_plan" "app_plan" {
  name                = "plan-${var.app_name}-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  os_type             = "Linux"
  sku_name            = "F1" # Free Tier (F1) is ideal for testing and avoids VM quota limits
}

# Linux Web App
resource "azurerm_linux_web_app" "app" {
  name                = "app-${var.app_name}-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  service_plan_id     = azurerm_service_plan.app_plan.id

  site_config {
    always_on = false # B1 plan supports false; saves resources
    application_stack {
      node_version = "20-lts"
    }
  }

  # Configure System-Assigned Managed Identity
  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    # Key Vault Reference to database connection string
    # Resolves securely at runtime using Web App's Managed Identity
    "DB_CONNECTION_STRING"      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.db_conn.id})"
    "WEBSITES_RUN_FROM_PACKAGE" = "1"
  }
}

# Key Vault Access Policy for Web App Managed Identity
resource "azurerm_key_vault_access_policy" "app_policy" {
  key_vault_id = azurerm_key_vault.kv.id
  tenant_id    = azurerm_linux_web_app.app.identity[0].tenant_id
  object_id    = azurerm_linux_web_app.app.identity[0].principal_id

  secret_permissions = [
    "Get", "List"
  ]
}
