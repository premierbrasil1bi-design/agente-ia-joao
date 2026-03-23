import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Client } = pg;

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false
  }); // Padronizado para usar apenas DATABASE_URL

  try {
    await client.connect();
    console.log("✅ CONECTOU NO NEON COM SUCESSO");

    const result = await client.query("SELECT NOW()");
    console.log("🟢 Banco respondeu:", result.rows[0]);

    await client.end();
  } catch (err) {
    console.error("❌ ERRO AO CONECTAR:");
    console.error(err.message);
  }
}

testConnection();