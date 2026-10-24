/**
 * Un refus adressé à l'agent : son message lui est rendu tel quel, en français, comme
 * résultat de l'outil.
 *
 * À part des erreurs HTTP, qui parlent à un client et en anglais, et des pannes, que le
 * daemon journalise : un refus est une réponse normale, pas un incident.
 */
export class Refusal extends Error {}
