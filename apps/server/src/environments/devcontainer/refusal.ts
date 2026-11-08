/** Pourquoi un conteneur ne peut pas servir : l'interface le traduit par son code. */
export class ContainerRefusal extends Error {
  constructor(
    readonly code:
      | 'devcontainer_missing'
      | 'devcontainer_docker_missing'
      | 'devcontainer_cli_missing'
      | 'devcontainer_failed'
      | 'devcontainer_foreign'
      | 'devcontainer_host_unreachable'
      | 'devcontainer_arch'
      | 'devcontainer_unconfined'
      | 'devcontainer_paths',
    message: string,
  ) {
    super(message)
    this.name = 'ContainerRefusal'
  }
}
