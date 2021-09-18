import { group, Group, subscription } from "./tools/Amqp";

@group("mojuru", "gateway")
export class Mojuru extends Group {
    @subscription("command")
    onCommand() {

    }
}
