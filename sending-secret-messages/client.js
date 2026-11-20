const io = require("socket.io-client");
const readline = require("readline");
const crypto = require("crypto");

const socket = io("http://localhost:3000");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
});

let targetUsername = "";
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
        console.log(`Welcome, ${username} to the chat`);

        // Register this client's real public key with the server
        socket.emit("registerPublicKey", {
            username,
            publicKey,
        });
        rl.prompt();

        rl.on("line", (message) => {
            if (message.trim()) {
                let match;
                if ((match = message.match(/^!secret (\w+)$/))) {
                    const target = match[1];
                    if (users.has(target)) {
                        targetUsername = target;
                        console.log(`Now secretly chatting with ${targetUsername}`);
                    } else {
                        console.log(`User "${target}" not found in chat.`);
                    }
                } else if (message.match(/^!exit$/)) {
                    console.log(`No more secretly chatting with ${targetUsername}`);
                    targetUsername = "";
                } else {
                    // If a secret target is set, encrypt the message with the target's public key
                    if (targetUsername) {
                        const targetPublicKey = users.get(targetUsername);
                        const encryptedMessage = crypto
                            .publicEncrypt(targetPublicKey, Buffer.from(message))
                            .toString("hex");

                        socket.emit("message", {
                            username,
                            message: encryptedMessage,
                            isSecret: true,
                        });
                    } else {
                        // Normal unencrypted message
                        socket.emit("message", {
                            username,
                            message,
                            isSecret: false,
                        });
                    }
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
    const { username: senderUsername, message: senderMessage, isSecret } = data;

    if (senderUsername !== username) {
        if (isSecret) {
            try {
                // Attempt to decrypt with this client's private key
                const decryptedMessage = crypto
                    .privateDecrypt(privateKey, Buffer.from(senderMessage, "hex"))
                    .toString("utf8");
                console.log(`${senderUsername} (secret): ${decryptedMessage}`);
            } catch (err) {
                // If decryption fails, this client is NOT the intended target—display ciphertext gibberish
                console.log(`${senderUsername}: ${senderMessage}`);
            }
        } else {
            console.log(`${senderUsername}: ${senderMessage}`);
        }
        rl.prompt();
    }
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