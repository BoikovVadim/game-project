import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { formatNum } from './formatNum.ts';
import './UsersList.css';

interface User {
  id: number;
  username: string;
  email: string;
}

const UsersList: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await axios.get('/users');
        setUsers(response.data);
      } catch (error) {
        console.error('Failed to fetch users', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Зарегистрированные пользователи</h2>
      <div className="userslist-table-wrap">
        <table className="userslist-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{formatNum(user.id)}</td>
                <td className="userslist-td-left">{user.username}</td>
                <td className="userslist-td-left">{user.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersList;