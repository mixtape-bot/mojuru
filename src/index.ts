import { Mojuru } from "./Mojuru";

async function main() {
    const mojuru = new Mojuru(process.env["TOKEN"]!);
    await mojuru.cluster.spawn({ type: "auto" });
}

void main();
