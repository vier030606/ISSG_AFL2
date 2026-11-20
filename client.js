const io = require("socket.io-client");
const readline = require("readline");
const crypto = require("crypto");

const socket = io("http://localhost:3000");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
});

let registeredUsername = "";
let username = "";
const users = new Map();

// Generate RSA key pair for this client
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

socket.on("connect", () => {
    console.log("Connected to the server");

    rl.question("Enter your username: ", (input) => {
        username = input;
        registeredUsername = input;
        console.log(`Welcome, ${username} to the chat`);

        // Send the client's actual RSA public key to the server
        socket.emit("registerPublicKey", {
            username,
            publicKey,
        });
        rl.prompt();

        rl.on("line", (message) => {
            if (message.trim()) {
                let match;
                if ((match = message.match(/^!impersonate (\w+)$/))) {
                    username = match[1];
                    console.log(`Now impersonating as ${username}`);
                } else if (message.match(/^!exit$/)) {
                    username = registeredUsername;
                    console.log(`Now you are ${username}`);
                } else {
                    // Sign the message using this client's private key
                    const signature = crypto
                        .sign("sha256", Buffer.from(message), privateKey)
                        .toString("hex");

                    socket.emit("message", { username, message, signature });
                }
            }
            rl.prompt();
        });
    });
});

socket.on("init", (keys) => {
    keys.forEach(([user, key]) => users.set(user, key));
    console.log(`\nThere are currently ${users.size} users in the chat`);
    rl.prompt();
});

socket.on("newUser", (data) => {
    const { username: newUsername, publicKey: newPublicKey } = data;
    users.set(newUsername, newPublicKey);
    console.log(`${newUsername} joined the chat`);
    rl.prompt();
});

socket.on("message", (data) => {
    const { username: senderUsername, message: senderMessage, signature } = data;
    const senderPublicKey = users.get(senderUsername);

    let isVerified = false;
    if (senderPublicKey && signature) {
        try {
            isVerified = crypto.verify(
                "sha256",
                Buffer.from(senderMessage),
                senderPublicKey,
                Buffer.from(signature, "hex")
            );
        } catch (err) {
            isVerified = false;
        }
    }

    // Ignore our own genuine messages, but DO NOT ignore someone impersonating us!
    if (senderUsername === registeredUsername && isVerified) {
        return;
    }

    if (!isVerified) {
        console.log(`⚠️ WARNING: This user is fake! (${senderUsername})`);
    }

    console.log(`${senderUsername}: ${senderMessage}`);
    rl.prompt();
});

socket.on("disconnect", () => {
    console.log("Server disconnected, Exiting...");
    rl.close();
    process.exit(0);
});

rl.on("SIGINT", () => {
    console.log("\nExiting...");
    socket.disconnect();
    rl.close();
    process.exit(0);
});