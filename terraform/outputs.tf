output "resource_group_name" {
  value       = azurerm_resource_group.rg.name
  description = "The name of the provisioned Azure Resource Group."
}

output "web_app_url" {
  value       = "https://${azurerm_linux_web_app.app.default_hostname}"
  description = "The URL of the deployed web application."
}

output "web_app_name" {
  value       = azurerm_linux_web_app.app.name
  description = "The name of the Azure App Service Web App."
}

output "sql_server_fqdn" {
  value       = azurerm_mssql_server.sql.fully_qualified_domain_name
  description = "The fully qualified domain name of the Azure SQL Server."
}

output "key_vault_name" {
  value       = azurerm_key_vault.kv.name
  description = "The name of the Azure Key Vault."
}

output "key_vault_uri" {
  value       = azurerm_key_vault.kv.vault_uri
  description = "The URI of the Azure Key Vault."
}
