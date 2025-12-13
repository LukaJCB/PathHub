import { FormEvent, useState } from "react";
import {AuthenticationClient, createAuthClient} from "pathhub-client/src/authClient.js"
import {makeStore} from "pathhub-client/src/indexedDbStore.js"
import { Link, useNavigate } from "react-router";
import { useAuth } from "./useAuth";


const LoginView: React.FC = () => {

    const { login } = useAuth();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        try {
            await login(username, password)
        } catch (e) {
            console.log(e)
        }
    }

    
    return (<><h2>Login</h2><form onSubmit={handleSubmit}>
      <label>Username:</label>
        <input
          type="text" 
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      
      <label>Password:</label>
        <input
          type="password" 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      
      <input type="submit" value={"Login"} />
    </form>
    <div>No account yet? <Link to="/register">Click here to Register!</Link>
        </div>
        </>)
}

export default LoginView
