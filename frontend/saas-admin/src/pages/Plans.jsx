import { useEffect, useState } from "react";
import { request } from "../api/http";

export default function Plans() {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    async function fetchPlans() {
      const res = await request("/api/platform/plans");
      if (res && res.ok) setPlans(await res.json());
      else setPlans([]);
    }
    fetchPlans();
  }, []);

  return (
    <div>
      <h2>Planos</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Preço</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {plans.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.price}</td>
              <td>{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
