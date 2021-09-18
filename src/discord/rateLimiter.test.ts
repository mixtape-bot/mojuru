import { RateLimiter } from "./rateLimiter";

async function main() {
    let consumptions = 0;
    const ratelimiter = new RateLimiter(1, 5000);

    async function consume() {
        let consumption = consumptions++;
        console.log(consumption, "consuming token.");
        const start = Date.now();
        await ratelimiter.consume()
        console.log(consumption, "took", Date.now() - start)
    }

    await consume();
    await Promise.all([consume(), consume()])
}

void main();
