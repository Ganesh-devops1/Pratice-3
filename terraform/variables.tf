variable "resource_group_name_prefix" {
  type        = string
  default     = "rg"
  description = "Prefix for the resource group name."
}

variable "location" {
  type        = string
  default     = "Central India"
  description = "Azure region for resources."
}

variable "app_name" {
  type        = string
  default     = "pratice-web"
  description = "The name of the application. Used to generate unique resource names."
}

variable "sql_admin_username" {
  type        = string
  default     = "sqladmin"
  description = "The administrator username for the Azure SQL Database server."
}

variable "sql_admin_password" {
  type        = string
  sensitive   = true
  description = "The administrator password for the Azure SQL Database server. Must meet Azure password requirements."
}
