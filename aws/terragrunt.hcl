locals {
}

inputs = {
  cid_api_key = "asdfasdfasdfasdf" 
}

terraform {
  before_hook "before_hook" {
    commands     = ["apply", "plan"]
    execute      = ["chmod", "-R", "o+rX", "../functions"]
  }
}
