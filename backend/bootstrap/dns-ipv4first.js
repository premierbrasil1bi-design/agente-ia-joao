/**
 * Deve ser o primeiro módulo carregado no processo (import antes de dotenv, pg, filas).
 * Força o Node a priorizar IPv4 ao resolver DNS, reduzindo EAI_AGAIN / falhas com Neon
 * e outros hosts quando a VPS ou rota IPv6 está instável.
 */
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
